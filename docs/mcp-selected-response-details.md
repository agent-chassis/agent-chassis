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

## Delivery classes

Compact discovery, summaries, ordinary results, refusals and recovery frames keep
their existing admission bounds. Compact selected-response discovery uses
`min(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES,activeMcpInlineByteLimit())`, at
most 8,192 admission bytes. Ordinary responses use the active inline limit,
128 KiB by default. Admission measures the larger compact structured value or
delivered text, including escaping and calls, plus nonmirrored content and
protocol metadata. Physical serialized wire size carries both representations
and is a distinct measurement. Native test answers preserve the 1,024 UTF-8 byte
total response exception.

An ordinary overflow retains its original internally and returns no public byte
reader or reconstruction instructions. When its producer registered a semantic
read, recovery names that exact call. Otherwise the response states
`complete:false`, `no_supported_route:true` and missing capability
`authorized_semantic_selection`; retention alone does not establish delivery.
Never repeat an effectful producer to retrieve its earlier output.

Validation preserves every issue, nested union constraint and long deciding
message. Delivery, integration, retention and material failures preserve their
causes, subjects and known effects. Structured process diagnoses carry exit and
error facts rather than raw stdout/stderr. Refresh workers preserve every
distinct explicit error line separately from their bounded internal debug capture.
Long delivery and integration summaries, including retained `get_run_result`
reads, use the same authenticated whole-selection delivery. Complete diagnostic
selections use their authenticated original owners; arbitrary prose or issue-count cutoffs do
not replace correction meaning. Missing caller choices stay incomplete, and a
read-only guidance alternative is not an executable corrected mutation.

Compact saves preserve every issued key-to-identity mapping, including saves
containing only obligations and cases. Unkeyed rows retain their row receipts; keyed rows are delivered once in
`bindings`, alongside the current revision. When those essential mappings exceed the compact admission bound,
the existing authenticated whole-selection class delivers them together; no
coverage read, statement matching or positional correlation is required.

Explicitly requested authenticated complete reads use the existing selected-full
delivery class without a byte ceiling, even above the ordinary inline limit.
They deliver the complete canonical value with one generated text mirror in the
same response. No truncation, spill-reader detour, pagination or agent assembly
is required. Reads retain no replacement original and rerun no producer.

Only the authenticated selected owner's private provenance grants this delivery
class. The guard remembers the canonical selected bytes and result identity;
its normalization preserves authentication, while copying the outer result or
replacing or mutating selected content uses ordinary admission. Handler text
is regenerated from the canonical value. Protocol metadata and non-text blocks
are preserved and must serialize. Nonnumeric serialization failures remain
errors. Arbitrary handler output, copied values and caller flags such as
`complete:true` grant no exemption. Authentication, source integrity, currentness
and role/repository/unit/session authorization remain required before projection.

## Case-authoring readback

Before authoring or checking cases, follow the saved-unit context's
`case_authoring_readback` call. It selects the existing `{contract:"cases"}`
population. `members` contains every case used by that selected unit;
`case_authoring.obligations` contains every obligation in the same authorized
population, including obligations without a case. Match `case_id` to `case_id`;
no case is selected for the caller. `case_authoring.references` defines each
referenced case component once. Criteria, source notes and residue accompany
those mappings. The context names its unit, record/slice scope and combined
revision, and reports complete population counts.

Check the unit and revision before using the mappings for a save. A slice read
keeps the slice's obligations and linked parent-owned cases; parent coverage
supplies no slice coverage. If a read refuses because its source changed, follow
the returned current-context call and select case readback again. Do not reuse
an old revision or infer missing identities. Readback executes no test or proof
and grants no credit.

This selection is complete for case authoring, not for the whole specification:
`complete_contract` is false. Full requirement meaning, generated CEL and the
complete coverage selection remain available through their own existing reads.
The server's complete coverage response is not a guarantee that a native client
can deliver an arbitrarily large value whole. A finite successful case-selection
witness establishes only the tested populations, not unlimited delivery.

## Focused review meaning

Saved-unit contexts offer `associated_review_meaning`, selecting
`{contract:"obligations",view:"associated"}` through their existing reference.
The result keeps the unit's obligation rows in `members` and returns their
associated requirement meaning, definition graph, reference definitions, cases,
criteria, notes and residue once in `associated_meaning`. It uses the query
owner's associated closure; unrelated parent requirements do not enter a slice
selection. Distinct claim, reference, definition and case identities stay distinct.
This is review material for the selected unit, not complete parent coverage.

The ordinary `{contract:"obligations"}` inventory remains row-only. The existing
single-obligation associated read, parameter read and row read also retain their
meanings. `{contract:"coverage"}` still returns complete coverage with all parent
requirement meaning. Parent obligation reads do not include slice obligations:
use the returned slice inventory and its all-member binding for the requested
review population. Empty parent fields leave slice design explicitly unread.

Read assignment, scope, dependencies, criteria and planned validation through
each slice's field inventory. It includes saved planning facts independently of
the editing registry, and names the shared parent user-requirements field.
All these reads retain the existing role grants and frozen source binding.

## Saved obligation row readback

`workspace_read_wiki` accepts a returned saved-unit reference with
`select:{obligation:<saved id>,view:"row"}`. It authenticates the same repository,
role, assigned population and frozen source as the associated-context obligation
read, then selects the exact saved row from that query owner. The result states
`unit`, record/slice `scope`, source identity, `revision`, `content_digest`, and an
`obligation_row` extent of one. `row` preserves statement, claim and criterion
identities, case/selection pins and explicit exception facts. `complete_contract`
is false: this observation establishes no specification or proof verdict.

Omitting `view` keeps the existing associated-context read. Its `parameters:true`
modifier remains unchanged; combining it with `view:"row"` is refused by the
closed request variants. Both explicitly selected views deliver their complete
authenticated content through selected-full delivery without a byte ceiling.
Unknown identities keep the native not-found cause
and a callable public recovery; source movement and foreign references keep the
incumbent authentication/currentness refusals.

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
final response guard recognizes the unchanged selected content and regenerates
its text from the same canonical value. Complete reads bypass compact and
ordinary inline admission; mutations of the selected value use ordinary admission.
The exemption requires both the authenticated result object and its unchanged
selected value. Copying the outer result while retaining its payload reference
does not transfer the private result authentication.

A compact save receipt preserves the save owner's complete requirement-row,
claim and verification mappings in `requirement_rows` and `bindings`. Counts
describe populations; they do not replace those mappings. If these essential
facts exceed ordinary inline admission, the save owner authenticates its retained
observation (or original save facts) and delivers the compact projection through
this same whole-selection class. Assessment, maintenance detail and full authored
meaning remain separately readable; `complete:false` still names omitted detail.

Assessment diagnosis inventories use this same authenticated projection and
complete selected delivery. `workspace_assess_contract` accepts
`{original:{source:{ref_id},view:"diagnoses"}}`, exclusively of nested diagnosis
or obligation selectors. The view returns diagnostic identities, native
meanings, affected populations and targeted diagnosis reads from the already
retained assessment, including oversized inventories. Complete delivery does
not repair fresh assessment navigation or establish that the owner captured
every diagnosis. Equivalent semantic observations share one choice only when
all caller facts agree, including subjects, evidence and recovery; owner and row
identities alone do not require repeated inspection. `equivalent_diagnoses`
preserves the other retained identities and owners, which remain independently
readable. Choice counts describe this menu; `retained_diagnoses_total` and
`equivalent_diagnoses` counts disclose consolidation when present. Same-label
choices with different facts carry `choice.differences`, naming concrete affected
fields and values before selection. Retained originals are unchanged.
It exposes no compiler output, full subject bodies or schemas, creates no new retained source
and reruns no assessment. Owner-family
incompleteness and unavailability remain explicit. Fresh assessments reserve
compact navigation independently of large issue bodies, under the unchanged
compact and active inline bounds. Source movement and restart change only the
reported currentness observation, never the retained diagnosis facts.

The production reader, code-index selections, candidate/publication/landing
originals and common-result semantic detail use this same delivery class and owner.
Create/save receipts, proof discovery, run-result selections and closeout receipts
also cross this boundary. Where their owners permit a complete selection,
records, entry bodies, histories, documents, schemas, assessment
originals/inventories and these consumers deliver their complete authenticated
values without a byte ceiling.
Existing semantic selectors remain available; no new selector is implied.
They add no parallel store, schema table, fallback parser or public owner router.

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

Saved parent and slice planning contexts remain readable when no controlled
contract was authored. They retain the save owner's combined revision and its
currentness checks; the launcher prepares the empty private store before any
read. Contract selections report that captured absence with `present:false`.
An unavailable or invalid store is a source failure, never an empty contract.

Native controlled-contract failures during context or selected reads use
`workspace-read-wiki-source-refusal.v1` with their owner code, message and
details. Filesystem failures retain the deciding cause, source path and
operation where available in `details.source_failure`; an unwrapped filesystem
error uses `workspace_read_wiki_source_unavailable` and preserves its native
cause. These failures are not `mcp_response.handler_exception.v1`. No read
repairs a source or switches to live content. When no authorized corrective
call exists, `next_calls` is empty and recovery names the responsible actor:
the coordinator or operator repairs the reported condition and dispatches a
fresh frozen review, or the repository owner repairs a live source.

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

A complete `select:{inventory:"slices"}` population preserves every slice in
source order with its unchanged `id`, complete `unit` and descriptive facts.
When nonempty and the session can read work contexts, it returns one exact
recommended `workspace_read_wiki({subject:members[0].unit})` call and one shared
`selection_context` with `tool:"workspace_read_wiki"` and the binding rule:
`Use {subject:members[i].unit} unchanged to open each slice's context, then its returned reference and selections to read its contents.`
This is the existing subject read; a parent reference does not select a child.
Each child context supplies its own reference and selections. Its complete
field inventory declares how to select saved assignment/planning fields,
scopes, acceptance criteria and planned validation, and its existing
`{contract:"coverage"}` selection returns saved requirements and obligations.
The inventory carries no child contents or repeated field/contract menus.
Empty inventories and sessions without context grants offer no child call or
binding. Authentication, frozen-source selection, currentness and complete
retrieval remain with their existing owners; navigation grants no authority and
performs no canonical write.

A selected entry body also returns `reference`, the entry owner's immutable
reference string for the exact returned `entry_id` and `version_id`, including
when the request selected the current version. Pass it unchanged as
`save_record`'s `changes.material_refs:[{ref:reference}]`, or read it with
`workspace_read_wiki({reference:{ref:reference},select:{field:"text"}})`.
The answer also supplies an immutable reopen call and `material_binding.value`.
Authoring-capable readers receive an explicitly incomplete target-context binding;
the caller chooses the target and acquires its current revision and schema.
Findings readers receive read-only reuse guidance. No target, revision or write
authority comes from the material reference.
It pins the complete returned body after later versions are appended. It is
distinct from the context's retained `{ref_id}` locator and grants no
source visibility: reads and assignment preparation still authenticate the
repository, source and role or frozen scope through their existing owners.

A WK root or slice context returns one `reference` and the complete ordered
`selections` it offers under the session's grants. The recommended selection is the first member of `selections`. Task-relevant
associated review, saved-requirement summary and case-authoring reads may also
be offered explicitly; a context with no granted selection publishes none. Every other choice is read by passing that `reference` unchanged with one
returned selector unchanged, as `{reference, select: selections[i]}`. The
reference is stated once beside the expanded call instead of once per choice,
and there is no per-selection call list, second navigation array or derived
selector. Selection order, grants, authentication, currentness and refusals are
those of the expanded form. Other contexts keep one expanded call per selection.

The root's slice inventory contains assignment choices rather than summary
bodies: unit, title, status, work kind and applicable review purpose. Repeated
titles may also carry complete authored edit targets and the authored leading
Markdown `assignment_heading`. Identical public descriptions retain every slice
with `choice_state:"ambiguous"`. The common selection binding opens the chosen
slice context; its returned summary selection preserves the complete assignment.
Neither list order nor a matching label establishes applicability or selects a
slice for the caller.

A requirement-guidance context is read the same way, and its one `reference`
serves every topic it offers. A complete topic answer returns that `reference`
unchanged with `selections`, the other offered topics in the context's order
without the topic just returned, so another topic is read as
`{reference, select: selections[i]}` with no further context request. The
answer is complete for the named instruction selection. The save instruction topic
promotes callable compact-example and complete-schema selections in `next_calls`;
its deferred schemas are absent from the instruction value. An optional
`subject.topic` only chooses the context's recommended selection.

`authoring_vocabulary` is one complete authoring-job selection: common vocabulary
definitions appear once, and each complete relation signature states every
allowed position among `behavior`, `fails_when` and `observes`. Operand bounds,
applicability modes and their definitions remain local to that answer. Position
membership is explicit; an observation-only relation is unavailable wherever
the owner forbids it. This answer and its recommendations are derived from the
existing vocabulary owners, while separate position-topic reads remain complete.
Relation rows carry compact identities and signatures. The single shared
`relation_definition_read` call opens the existing CEL definition reader. Use its
returned reference with
`select:{guidance:["cel_definitions","relations",<selected row.term>]}` to read
the complete canonical definition, semantic references, observations and lowering.
The selected answer links callable reads of the applicable pinned upstream
operations. Local application constraints retain their own attribution.
For example, `value:add` links CEL list concatenation; `value:contains` links
exact string substring semantics; `value:equal_to` explains complete typed
comparison while `value:equals` remains a subject-value equation. Selected
permission guidance explains active positive permissions and negative-only
prohibitions with a concrete empty-search counterexample. Separate and combined
initial answers share this route without repeating full calls or definitions in
every row. The meaning remains reachable without implementation-source reads.
A detail read writes nothing, executes no proof and grants no proof credit.

`['case_authoring','family',<explicit family>]` selects common case semantics and
the complete chosen family's instructions, targets, constraints, falsifiers and
language-appropriate examples. Its value identifies the selected scope. The
general `case_authoring` answer remains complete for all families. General and
scoped case answers additionally offer each other supported family as a complete
guidance selector, using the same authenticated reference. A missing, unsupported
or further fragmented family selection refuses with the actual selector and a
call to guidance context; it substitutes no family. These selections reuse the
ordinary guidance grants and selected-full transport, retaining every selected
instruction without a size cap, pager or separate registry.

### Saved requirement model selections

Record contexts with the requirements read grant offer
`{contract:"requirements",view:"summary"}` through `next_calls`, with purpose
`saved_requirements_summary`, as optional saved-meaning inspection before full
coverage. Requirements-focused contexts retain it; notes-only focused contexts
do not recommend it. The compact summary contains unit/source/currentness,
compilation and definition states and exact row/unresolved counts. Its
`selection_context` supplies the requirements `choices` template: reuse the
returned reference and select, then supply the caller's own nonblank `query`.
The summary contains no row previews or generated CEL. A requirement save receipt
supplies keyed issued bindings and its current write revision directly. The
summary's optional `requirement_identities` call inspects missing saved-row
information; no coverage read is needed solely
for identities. Historical row order cannot recover lost caller-local keys.
Returned row identities have exact calls for these strict selections:

- `{contract:"requirements",view:"choices",query:<caller words>}`: every matching
  row choice in source order. Each whitespace-separated term must occur literally,
  ignoring case, within a scalar of the row's own authored statement; terms may
  match different values. Punctuation is literal. Metadata, rendered vocabulary
  and transitive definitions are not searched. A defining row's own body is
  searched even though its choice description leaves that body to the selected
  row read. The response preserves the query, matching rule,
  `matching.population_count` and complete `matching.matched_count`. A lexical
  no-match response establishes no applicability and offers the query template
  for refinement plus a concrete complete-inventory call. Absent source, empty
  present population and unavailable source remain distinct from no match.
- `{contract:"requirements",view:"choices"}`: explicit complete row inventory using exact
  structured `authored_statement` fields and source state, plus pending fields for
  incomplete rows. Rendered meanings and definition expansions stay in selected
  reads. Defining rows retain `definition:true`, omit their defining
  `behavior.objects` from choices and declare `definition_body:"selected_row"`.
  Normative constraint operands remain available to distinguish constraints.
  Indistinguishable descriptions keep every row with `choice_state:"ambiguous"`.
  The shared selection binding opens the exact row, verifications or dependencies.
- `{contract:"requirements",view:"identities"}`: every authorized row's `row_id`,
  state, complete `constraint_ids` and `claim_ids`, the native
  claim-to-verification mappings and collection identities/members. No row preview
  cutoff applies. `row_id` addresses an authored row; individual claim IDs address
  claim associations. This identity inventory omits full authored meaning and
  compilation; it does not supply a current write revision. Its `next_calls`
  offers current unit context before a new save, including after source movement.
- `{contract:"requirements",view:"row",row_id:<returned id>}`: the complete saved
  input, canonical meaning, source link, identities and pending fields of one row.
- `{contract:"requirements",view:"verifications",row_id:<returned id>}`: the existing
  native verification meanings linked to that row, their requirement associations
  and referenced entities. The row read emits this exact call for faithful restatement.
- `{contract:"requirements",view:"dependencies",row_id:<returned id>}`: that row's
  transitive description roots/nodes, including lexical scopes and shared definitions.
- `{contract:"requirements",view:"compiled"}`: the existing compiled representation.
- `{contract:"requirements",view:"unresolved"}`: the complete saved unresolved population.
- `{contract:"requirements"}`: the existing full selected population.

Only choices accepts `query`; blank, non-string and wrong-view queries refuse
without selecting an implicit full inventory. Only row/verification/dependency
views take and require `row_id`; other contract populations reject modifiers.
Queries issue no write revision. The query owner resolves the authorized
population before the small route presentation helper selects it. An unknown or
out-of-population row refuses without exposing sibling rows. Source freshness, frozen references and
worker assignment bindings are checked by the existing reader. Selection never
assesses proofs, writes, compiles into storage or executes anything. Selected
response retention and delivery remain with `selected-response-snapshot`.

The compact example is selected by literal guidance path
`["compact_record_comparison"]`. Its applicability is explicit: group only fields
sharing applicability, observation boundary and comparison semantics. The default
recommended `save_record_inputs` read preserves common batch, identity, exact
source-link matching, draft and association instructions and links this example.
That initial answer recommends the compact example and keeps the complete schema
available without recommending it. Explicit topic contexts keep their requested
selection recommended. It embeds neither the example nor schema/definition copies.

Saved requirement rows use `row_id` with their complete authored meaning,
including grouped and incomplete rows. A single-claim requirement may use its
claim `id`; a claim from a grouped row requires `row_id`. Saved obligations use
`id`, and case reuse uses `case.id`. These are different row kinds, not aliases.

The default input and requirement-batch selections offer labelled, optional
specialized jobs instead of delivering their tutorials during initial authoring:
`["save_record_inputs","requirement_batch","correction"]` explains correction
and dependency migration; appending `["source_link","repair"]` to the batch
path explains faithful source-link repair; `["save_record_inputs","slice_coverage"]`
explains slice-local coverage using saved parent meaning. Each explicit selection
returns its complete existing instructions. Basic matching, current revision,
authoring permission and save validation remain unchanged.

Assessment diagnosis calls retain native cause codes for authoring and definition
choices and render semantic cause labels in readable words. They retain subject
counts and available recovery/category facts within the surrounding assessment's
unit and selected population. Semantic choices state cause labels
with their owner recovery classification, distinguishing inspection from authored correction before
the dossier is opened. The shared controlled-contract namespace is omitted from
the label; exact codes and full owner
explanations remain in the selected diagnosis. Compact choice populations still
state exact omissions; labels do not expand the response budget or certify
unoffered diagnoses.

`["requirement_schema","existing"]` serves the complete saved-row batch schema;
`["requirement_schema","birth"]` serves its creation form. Append one definition
name to obtain a schema rooted at that definition with its entire local reference
closure, once. A correction identifying one row definition uses that focused root;
one that needs several row roots keeps a complete combined batch read. The birth
form has only this address, also advertised by the creation declaration. The `requirement_schema`
topic itself is an index. Guidance revision includes hidden structural children
and exposure metadata, so detail changes invalidate held references.

### Save input contract selection

The reference of a saved work item, work item slice, initiative or decision
also reads the registered `save_record` schema of the `changes` members one
authoring job needs. `save_record`'s published declaration lists every member
and defers each composite member's nested declaration to this selection, so it
is where a caller reads a row's members, requiredness and constraints:

```text
workspace_read_wiki({reference:<returned record reference>,
  select:{input_contract:{tool:"save_record",members:["criteria","requirements","obligations"]}}})
```

The selector is strict: the literal tool `save_record` and a nonempty list of
member names, each once. Optional `branches:{requirements:[...]}` selects
owner-published capabilities in one coherent read: `relationships`,
`scalar_values`, `typed_values`. `typed_values` declares `scalar_values` as a
dependency. The relationship scope retains ordinary reference, boolean and
numeric statements, named membership and complete independent verification.
Scalar values add primitive named definitions, literals, references, observations
and scalar operators; typed values add recursive structure, nested selection,
bindings, lexical scopes and typed membership domains. Retained alternatives
keep their owner's constraints. The answer states requested/effective scope,
dependency additions, families, exact terms and exclusions. Guidance signatures
use the same scope and keep separate position permissions.

`{tool,view:"choices",members:[...]}` returns the relationship and scalar job
choices and the whole-member alternative. The typed relationship union retains
the entire grammar, so it uses the complete route: there is no scoped twin with
extra metadata or longer guidance routes. An explicitly selected capability union
that excludes nothing also returns the whole schema and whole guidance identity.
The compact batch instructions publish `schema_selection.whole_for` from that
same capability owner. Contexts keep their existing first recommendation.
Gather all known upcoming needs before the first read and select them together.
Use the whole route when later needs are unsettled; reuse held schema and semantic
instructions across saves and correctable refusals. A genuinely unforeseen need
outside a held narrow scope requires one complete union read; the earlier reply
remains part of the journey cost. The returned opaque `identity` binds the subject, source,
metadata, member population and effective scope. A disclosure grants no write
permission and is never a prerequisite for saving. Unknown or repeated capability
keys refuse with a callable choices route; malformed or unknown refused save
intent also routes to choices rather than guessing a narrower scope.

Without branches, the selection returns complete members. It takes no repository, kind, variant, role, digest or
field path. One read names every member the job needs and returns them
together; there is no read per member or per definition. The role's request
schema declares the selector, and any members of the unit's variant may be
named together.

The unit the authenticated reference names decides the variant, by the same
unit-address rule `save_record` uses. A reference to a document, repository,
assignment, entry or receipt is not a saved unit and is refused. The schema is
selected from the exposure the live `save_record` registration of the serving
registrar bound (see [MCP Integration](mcp-integration.md#registered-request-contracts)),
never rebuilt by the reader. The central policy grants the
`(record, input_contract)` and `(canonical_record, input_contract)` pairs to
the orchestrator and operator roles, the roles that hold `save_record`; a role
without the grant has no such selector in its request schema. A granted role in
a session with no registered `save_record` binding is refused with no supported
route, and the refusal names the missing registration.

The answer states, as separate facts, the unit, the derived variant, the
selected members in the owner's order, the digest of the whole variant schema and
its capability/guidance exposure metadata,
the complete selected schema, and the record's current authoring revision. The
digest identifies the schema and does not change with the record; the revision
identifies the record. `coverage` states that the schema is structurally
complete for the selected members and that semantic rules are decided by
`save_record` and its owners when a save is made. `guidance` lists the owner's
topic paths for the selected members, and `next_calls` holds the
requirement-guidance reads for those paths that the serving registrar accepts.
The answer never contains a `save_record` call. Proof-specific input stays with
`workspace_find_proofs`. An explicitly selected schema is delivered whole on
both carriers without compact or ordinary inline byte admission. Every selected
member and its complete reachable definitions stay intact, regardless of size.

A held schema stays usable after saves: reading it is never required before a
save, grants nothing, and yields no token a save takes. When only the record's
revision moved after the reference was returned, the same unit, variant and
members still select the same schema, so the current schema is served in the
same call and `recovered` reports the observed and current revisions and the
unchanged unit, variant and members. Nothing is written and no save is retried.
Every other selection of a moved reference keeps `source_moved`.

A refusal states its cause, the subject, that nothing was written and that no
schema was disclosed. A member the unit's variant does not take is refused with
the names that are not applicable and the variant's valid member names; the
caller chooses, and no member is dropped or substituted. A repeated member name
is refused the same way. A unit that can no longer be read, or one no save
variant covers, is refused with no supported route: no other unit or variant
stands in for it.

#### Navigation to the selection

A saved unit's context offers the selection as optional job choices. After the
context's own calls, which keep their order and their one recommendation,
`next_calls` holds one executable read per coherent job, through the context's
own `reference`, each with a `job` name and a `purpose`. A work item or slice
is offered `record_editing` (content, planning, tasks, review evidence,
lifecycle and removals), `acceptance_work` (criteria, requirements, obligations
and controlled acceptance) and `slice_planning` (slices and ready slices, with
the slice contract members on a slice unit). An initiative or decision is
offered one `record_editing` choice of its whole record. A job is a combination
of the save owner's member groups resolved against the unit's own source, so
together the jobs name every member once. The choices are never recommended,
are not listed in `selections`, and embed no schema. They are presets, not a
sequence, a dependency or a permission: a caller may name any members of the
variant in one selection, across jobs.

The choices appear only for a role granted the selection, over a live
`save_record` binding, and only when the serving reader accepts each exact
call. A document, repository, assignment, search or receipt context, and a
role that cannot author, is offered none.

For a known correction, `workspace_read_wiki({subject: unit, select:
{context:true, for_changes:["controlled_acceptance"]}})` returns the same
current context and write revision with navigation for the requested members.
This is a compact context selection, not a full read without a reference.
The same selection works with a returned reference; a moved source is reopened
once and disclosed under the existing context-currentness rule. Source and
selection grants are unchanged. Every requested member is validated by the
save exposure owner; unknown or repeated members are refused, never dropped.

The focused context retains the complete granted `selections` and current
authored context. Its `next_calls` recommends one complete schema read for all
requested members together and offers ordinary context discovery through the
same reference. Ordinary contexts keep the complete job menu. A changed need
can therefore acquire a whole coherent job without walking member-by-member.
The focus changes navigation only; it restricts neither accepted writes nor
the granted semantic selections.

`authoring_context` identifies the tool, unit, variant, owner-ordered members
and `owner_schema_digest`. A caller holding the complete, unbranched selected
schema and its instructions may reuse them only when all those values match.
A missing or different identity, different members, another unit or a scoped
schema requires the appropriate schema read. These are the exposure owner's
existing identities, not a cache inferred from conversation history. Reuse
never supplies a write revision: each correction still reads the current unit,
and `save_record` still checks the supplied revision. An independently selected
diagnosis includes its own instruction and schema route without assuming any
held information.

A refused `save_record` offers the same selection sized to the request. When
the unit is a saved unit, `changes` is a nonempty object and every one of its
members belongs to that unit's variant, the refusal's `next_calls` holds one
read of all the members the request named, in the owner's order. This covers a
malformed nested value and an owner's semantic refusal alike. The schema is
structural guidance and is not presented as resolving a semantic cause: the
refusal keeps its cause, field facts, caller choices and the owner's own
guidance calls, which stay first and recommended, and a corrected request, when
one exists, remains the one recommended call. The read is never described as a
corrected save, and no save is retried.

To offer that read the save owner asks the serving reader for the refused
unit's current reference. The reader resolves the unit through its own source
owners, under the session's context and selection grants, and retains the
ordinary descriptor; the refusal reports that read and retention, and no
canonical data is written. When the session has no binding, reader, grant or
readable unit, the refusal states the missing capability and its owner instead
of a call, and the original refusal is unchanged.

No schema read is offered when the unit, the form of `changes` or any named
member is invalid, unknown or not of the unit's variant; the refusal stands as
made and no member is dropped or replaced. A stale revision keeps the unit's
current context as its one recommended recovery. A maintenance retry, a
published save and an unchanged save acquire no reference and offer no schema
read: a schema already held is reused.

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

An initiative's `validate_dispatch` recommendation requests
`start_agent({subject:<exact-unit>,preview:true})` through the serving request
contract. A missing exact unit remains a missing selection; an unavailable
role capability remains unavailable. `validate_record` separately requests
`workspace_assess_contract({unit})`; contract assessment does not substitute
for dispatch preview. Previews launch nothing, grant no launch permission and
report unchecked conditions as unchecked.

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

### Creation input contract selection

A record kind is a reader source of its own, so the grammar of a creation is
read before any record exists:

```text
workspace_read_wiki({subject:{record_kind:"work_item"}})
workspace_read_wiki({reference:<returned kind reference>,
  select:{input_contract:{tool:"workspace_create_record",members:[...]}}})
```

`workspace_create_record` publishes `kind`, `title` and, for each kind, every
`initial` member by name; a scalar member keeps its declaration and a composite
member's nested declaration is deferred to this selection. The kind's context
states the kind, its `initial` member names in the birth owner's order and the
digest of the kind's whole initial schema, which is also its `revision`: a kind
has no record revision, unit or receipt, and none is reported. Its `next_calls`
holds one optional `record_creation` read of every member through the
context's own reference. Any members of the kind may be named together, and one
read returns them with every definition they reference.

The schema is selected from the exposure the live `workspace_create_record`
registration of the serving registrar bound, derived from the birth owner's
per-kind schema, never rebuilt by the reader. A work item states the content
carrier its body-prose members, entries and ready-slice sections share once, as
a local definition of the same schema. The central policy grants the
`(record_kind, context)` and `(record_kind, input_contract)` pairs to the
orchestrator and operator roles, the roles that hold `workspace_create_record`;
a role without the grant has no kind subject and no such selector in its
request schema. Reading the contract is never required before a creation,
grants nothing and yields no token a creation takes; the full creation
validator decides every request.

A kind the manifest does not create, a member the kind does not take and a
repeated member are refused by name with the valid choices. `save_record` is
not read through a kind reference and `workspace_create_record` is not read
through a saved unit's: either pairing is refused with
`input_contract_tool_source_mismatch`. A session with no registered
`workspace_create_record` binding is refused with no supported route. No
refusal discloses a schema, and neither read writes anything.

### Selection forms

`workspace_read_wiki` publishes `select` as one object that lists every
selection key the role is granted. A key whose declaration is a scalar type or
a closed set of scalar values keeps it; a key whose value is structured is
listed by name with its description; a record field name is published as a
string, because the fields of a resource are that resource's own. The compact
object only widens: the role's full validator decides every request, including
that exactly one selection is named.

A selection whose value the caller must find is stated completely by the
answer that supplies those values. The entries inventory, the field inventory
and the obligation population each carry `selection_context`: the tool, the
same reference, and `form`, the validator's own declaration of that selection
for the session's role. A context's own `selections` and `next_calls` are
concrete requests and need no form.

## Proof discovery and code-index selections

`workspace_find_proofs` called with no arguments browses the catalogue when
catalogue discovery is the task. A held name/query goes directly to its read/search
without preliminary browsing. A browse returns every listed proof once, in the
catalogue owner's order, or a bounded count with one exact call
(`next_calls.catalogue`) to the complete retained list. Two request forms
follow and are never mixed. A fresh read of the current catalogue is
`{proof_name, part?, target_family?}`, or `{query, target_family?}` to search.
A read from a returned original is `{result, selection?: {proof_name?,
part?}}`. Top-level `proof_name` and `part` belong to a fresh read;
`target_family` belongs to a fresh `proof_name` or `query` request and never
to a retained selection. The tool description and each field's description
state this distinction, because a client may render the fields without their
dependencies. A nonempty catalogue or index carries an incomplete
`next_calls.select` form with `executable:false`, `known_arguments` preserving
`result`, and `missing_caller_input:["selection.proof_name"]`. It has no executable
`arguments` and chooses no default proof. The caller chooses a listed identity,
copies the known arguments and adds `selection.proof_name`; an optional later
part is `selection.part`. Once explicitly selected, a proof's own next calls
can name it executably. `tools/list`
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
default to the overview: assertion, exclusions, capability and fit limits,
with an exact optional authoring call. The overview also carries the exact catalogue `short_description`
and `usage` prerequisites and fit/misuse scenarios with their admitted boundary.
These inline illustrations do not establish source applicability or turn every
unsuitable case into an evaluator refusal. Catalogue/index rows remain unchanged.
An overview states `verification_capability` and carries no construction
inventory or definition digest; a selected family's falsification states each
strategy by its `required` and `not_allowed` authored fields, its field
patterns and its target constraint, without the mechanism name or the fields
the save derives. These
facts are selected semantic meaning, not paged byte reconstruction. Every stored
retained discovery selection observes the owner's current catalogue identity
without re-ranking or replacing its historical content. Movement during fresh
acquisition refuses the mixed population and supplies the supported fresh read.
An authenticated retained read stays historical and reports changed currentness,
or unavailable currentness with its exact inspection failure.

Authoring a proof that a test case verifies needs the family that runs the
test. `target_family` is an input of `workspace_find_proofs`, never of
`save_record`. When an answer carrying authoring has no selected family,
`authoring.family` names the missing input and its task, and
`next_calls.choose_family.choices` lists the case-authoring owner's families
(recognized alternatives only for an ambiguous query), by `family_id`, `runner`,
`source_suffixes` and `selector_fields`,
each with one exact call: `{proof_name, target_family, part: {kind:
"authoring"}}`. `runner`, there and in a selected family's
`authoring.family.runner`, identifies the proof family's runtime, for example
`deno` or `go-test`. It is not a `workspace_run_test` argument. For ordinary
test execution, workers supply the assigned `entrypoint` and a `selection`
(omit `selection` only when that entrypoint declares a default). Orchestrators
and reviewers supply `harness:{cwd,argv}` from the intended command;
orchestrators also supply the explicit `source` required by their tool schema.
Use the current role's `workspace_run_test` declaration and
[local test runtime setup](local-test-runtime-setup.md); do not invent a command
from a family name. A command label such as `deno test` is query vocabulary,
not a runner identifier. Each call is a
fresh read of the current catalogue that
returns a new result. `target_family` is no selection of a retained result,
so the earlier original is unchanged and stays without a family. No family is
defaulted or read ahead. A query that unambiguously names a family selects it
without choosing a proof or authorizing execution. A conflicting explicit family
is explained; routine selection-origin bookkeeping is omitted. An ambiguous query
offers discriminating fresh query-context choices. A family choice carries no
strategy tutorial or target/provider detail. Until a family is chosen, `save.awaits_family` names the case target
and falsification fields instead of listing the family among
`save.missing_inputs`. `next_calls.parts` offers the optional overview call and
explicitly incomplete parameter/constraint forms of the same retained result,
naming the missing parameter name or constraint ref. No first member is selected.
A parameter read offers exact calls for its constraints; a constraint read can
finish without returning to the overview. A selected or
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

An authoring answer carries calls that read its own retained result and, for a
missing family, the family choice. With an explicit `target_family`, it also
offers `next_calls.case_guidance`, the reader's focused guidance-context call,
and `authoring.case_guidance_selection`, the complete family selector, only when
the live serving reader contract admits that context call for this session.
A caller
holding a requirement-guidance reference can pass that reference and selector
directly; otherwise the focused context returns the exact selected read. Query
recognition alone offers no scoped guidance call. Inline strategy examples
accompany target constraints; there is no linked-example route. The selected proof's
`authoring` already states whether a case is required (`authoring.case`), the
values the answer establishes (`save.changes`) and every input that remains the
caller's own (`save.missing_inputs`). A proof that declares no test execution
lists no case input, family or case member, so nothing in its answer leads
into case authoring. Required configurable proof parameters in
`save.missing_inputs` come from retained source policies/cardinality, with schemas
left to parameter parts. The checklist is explicitly `executable:false` and describes a new complete
selection, not missing values in an existing WK; incomplete drafts remain savable. Selected
family target constraints include inline supported/rejected strategy snippets
chosen from the family’s existing languages, authored once per mechanism and
language variant. Retained reads preserve both guidance and examples. The answer
keeps its captured semantic facts; optional guidance navigation follows the
receiving registrar's actual reader grants and never widens them.

`query_code_index` retains its published-index and currentness owner. Its returned
selections deliver complete semantic rows through authenticated selected-full
projection. The public reader never consumes an oversized internal spill page or
reruns the original query merely to recover an original.

Default code-index status keeps availability, indexed commit, observed HEAD,
freshness, dirty state, base/SCIP usability and coverage qualifications,
without the store's own incarnation and publication sequence (available only in
the complete selected `graph_snapshot`): the
project, inactive-project, project-document, covered and uncovered document
counts and every scalar base, provider and SCIP fact, with unknown counts left
unknown. Deep provider and provenance populations remain exact in
authenticated status selections. File context leads with the requested file
and recommends its complete `source`. Both summaries carry concise
`selected_detail.choices`, sharing `source`. Each choice
is composed as `{detail:{source:selected_detail.source,...choice}}` on the same
route. Status retains its evidence once without indexing or requesting refresh;
selected reads retain nothing further. Passive same-HEAD status keeps freshness
`unknown` with `checkout_freshness_unverified` until checkout inputs have been
verified by their existing owner; usability and exact publication identity remain
separate facts.

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
owners. A compact diagnosis may show a message prefix; its exact proof selection
reads the complete retained message, native cause/aggregate relationships and
captured issue facts through that same owner. Capture loss remains explicit;
readback never fabricates missing capture. A required standalone proof projection
that exceeds ordinary admission is delivered whole from its authenticated original.
Recorded worker selections use their authenticated journal/cache original for the
same complete delivery. Oversized modeled refusals likewise deliver the permitted public diagnosis from
the producer's existing retained diagnostic original, excluding private exception
capture; this creates no generic byte-reading route and replays no producer. Native originals use the native outcome reader and its strict bound;
that owner retains its read/continue/retry vocabulary and source checks.

Coordinators discover recorded proofs through the selected run's compact
`proof_verification`: `recorded` carries its exact count and inventory call, and
`unavailable` carries the actual evidence failure. Healthy empty proof bookkeeping
is omitted. An absent journal that cannot select the requested attempt reports
that selection failure, without inventing a proof population. Following the
inventory call returns all invocation rows from one validated journal prefix,
including their requested subject, outcome, any tested candidate commit/branch
and exact original read calls. Capture digests and source-construction carriers
remain internal. A later append does not alter
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
review sources retain their specific acquisition boundaries. Reviewer authoring recovery grants no foreign proof-original read route.
A reviewer may inspect the immutable standalone proof result its own authenticated
findings action executed, including failed and unproven outcomes. Retention binds
the existing native authority identity (assigned unit, action run, immutable review
source); the result reader requires that exact identity before projection. Another
action with identical inputs, a guessed locator or the same repository grants no
read. Foreign, forged, missing and corrupt bindings refuse before content is
returned. Predecessor-review reads and whole-WK execution are separate boundaries;
redteam receives no execution or result privilege. Source movement or later successful proofs
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

A failed subordinate delivery original refuses the whole attempt observation
with `delivery_receipt_unreadable`. Its details identify the subject, selected
attempt and failed receipt by locator and zero-based position, preserving the
underlying reader diagnostic. Missing and corrupt originals remain distinct,
regardless of their position among valid receipts. The refusal states that no
execution, integration or retention occurred and offers no speculative recovery.

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
promise. Observation summaries keep the shared summary bound; authenticated
complete original selections use selected-full delivery without a byte ceiling.

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
results remain available to their authenticated execution role. Reviewer standalone
proof results require the same authenticated action identity as their producer.

An integration response distinguishes an original's retained availability from
the current session's ability to read it. Every offered read, correction,
recovery and verification call is checked against the existing role grant and
the serving registrar's current request contract. `continuation_limitations`
names withheld operations and whether the role, registration or exact arguments
make them unavailable; confirmed effects and retained originals are unchanged.
Missing launcher-session authentication is reported with its owner's specific
cause and an explicit stop before reading a delivery or retaining an original.

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

Wiki context delivery preserves its authorized resource identity and semantic
selection calls even when context facts exceed ordinary response admission.
Document/work contexts, assignments and search contexts use their already retained
resource descriptor and the reader's exact repository/unit/session binding for
whole context projection. This transport step neither reopens a source nor
replays an operation or retains another descriptor. Missing/foreign descriptors
refuse rather than acquiring broader authority. Arbitrary payloads without a
semantic owner remain explicit incomplete-delivery failures.

## Scope and structured-entry navigation

A work unit’s fields inventory offers `navigation` for `read_scope` and
`write_scope`: `{field,directory:"."}` opens the directory tree. Each answer
returns every direct path, the complete child-directory inventory with counts,
and exact child calls. A child selects a repository directory, never a byte
range or a page. The `full_selection` still reads the complete original field.
This does not change assignment construction or expand a scope.

An entry inventory’s `navigation` selects structured JSON when its inline text
is JSON (optionally preceded by a provenance paragraph); ordinary entries keep
the complete entry read. `{entry,version,view:"structure"}` returns named members
and one shared selection binding within the same immutable version. Object keys and unique `id` or
`*_id` row values are semantic path segments, never array positions. `path`
comes from these calls; `full:true` reads the complete selected node. Atomic
values and arrays without unique named rows remain whole. Each answer preserves
the provenance paragraph, root scalar context, version and immutable original reference; `original`
reopens the exact original text. Invalid JSON or missing members refuse with an
exact full-entry recovery. No source is rewritten or recaptured.

A complete entry read retains an optional, nonrecommended immutable reopen call.
It recommends no duplicate acquisition. Structured navigation and complete reads
share the reader’s existing source authorization, retained descriptor and
selected-full delivery owner. Navigation reduces irrelevant acquisition; it
provides no universal guarantee that an arbitrary complete selection fits every
native client. Native receipt must be checked at the outgoing model request,
separately from server delivery, relevance and completion.

## Complete proof outcome selections

Standalone, worker-recorded and coordinator reads preserve the selected test
outcome, execution state, relationship result and deciding causes separately.
A passing test can remain unproven when behavioral coverage is unestablished.
The issuing result or invocation reference binds subsequent reads; internal
result digests, checker provenance and projection inventories are not readback
requirements. Distinct authored final texts remain available, with duplicate
text represented once by a reference.

When compact proof rows omit part of the selected population, the returned
`proof_population` call reads every selected outcome through the existing
`get_run_result` proof selector. That authenticated whole selection supplies
proof and obligation identities and usable diagnosis calls, without execution
or a new discovery API. A coordinator's complete outcome uses one proof list,
including selected diagnoses, instead of a second parallel detail population.

An immutable maintenance receipt remains historical. Busy maintenance has no
public forward-observation selector; replaying a mutation is not observation.
A lost creation acknowledgment has no operation-bound recovery identity, and
an inventory cannot reconstruct lost caller-local keys by row order. These
routes remain blocked at those missing mechanisms; stop dependent work rather
than infer success or repeat creation.

## Focused choices in existing reads

The obligations population offers `view:"proofs"` for obligation meaning and
saved proof names. Reuse its declared common proof-read arguments instead of
reading full coverage to discover a selected proof. Unselected and declined
proofs stay explicit, and discovery grants no execution permission.

A frozen assignment offers `field:"test_commands"` through its returned
reference. The complete selection states each entrypoint's purpose, selection
identities, command meaning and authored default when present. The caller chooses
a selection and uses the declared common run arguments. Definition digests,
base captures and provenance stay private. The read executes nothing and does
not grant a missing command.

Oversized durable attempt or delivery choices, and authored final results without
a separate original binding, use the authenticated journal source for
whole-selection delivery. A journal-backed final result is preserved before
transport admission; compact presentation must not discard it first. That
source's bytes never enter a public
failure diagnosis. A live observation without an authenticated source remains
explicitly incomplete when required choices cannot fit; no choice is guessed.

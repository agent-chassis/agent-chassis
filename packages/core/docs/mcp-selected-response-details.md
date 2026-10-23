# MCP Selected Response Details

This page owns the serving composition for compact summaries and complete,
authenticated semantic selections. The task contracts are described in
[MCP Operation Reference](mcp-operation-reference.md) and
[MCP Integration](mcp-integration.md).

## Owners

`packages/wiki-mcp/src/lib/selected-response-snapshot.mjs` composes the incumbent
response retention, verified byte reader, registry and continuation owners. It
adds no store, codec, authority identity or independent limit.

`selected-response-observation.mjs` owns retained observation currentness and
failure diagnosis for both assessment originals and code answers. The shared
`code-index-query-contract.mjs` owns the code route identity used by retained
impact readers. Neither shared owner loads code-query implementations.

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

When retention is unavailable, an authenticated task can deliver its already
produced complete semantic projection through `completeProducedContent` in the
same response owner. This preserves necessary mappings, independent causes and
known effects without a new read or repeated mutation. It creates no retained
lookup or recovery permission. Ordinary admission bounds are unchanged; the
complete class carries only the task's permitted meaning. The same guard checks
result identity and unchanged canonical content before serving either class.

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

## Case and obligation meaning

Read the needed case, obligation and requirement selections together through
`workspace_read_wiki`'s `reads` envelope. Cases and obligations have public
identities; requirements and verifications use authored semantic selectors.
The shared source owner resolves their exact saved associations. Case components
use natural entity meaning rather than private reference identities. A selected
verification includes its complete saved runtime declaration when established,
including case-owned meaning. Intentionally absent declarations stay absent;
unavailable association evidence never selects another verification.

A draft obligation may omit its optional requirement association. That absence
and an explicit empty association both establish an empty associated claim and
verification set. They retain the draft statement and invent no coverage. Malformed bindings,
unresolved saved associations and incomplete source evidence remain unavailable.

Selected obligations return `claims:[Selector,...]`, reusable in the save
owner's `changes.obligations[].claims` under the current revision. Complete
behavioral membership uses a whole-requirement selector; grouped subsets use
claim selectors and explicit verification links use verification selectors.
Mixed associations preserve each kind without widening or dropping membership.
No parallel `requirements` association list is published.

Saved selections keep their captured meaning during amendments. Save's explicit
`replacement_key` names the submitted assertion population; a claim selector
with `requirement:"$key"` narrows that population to exactly one submitted part.
The submitted verification keeps its own binding. Such local keys are not reader
selectors. Ambiguity choices preserve their local binding; fresh readback returns
saved selectors with exact memberships. Success does not require that readback.

Obligation-associated requirements are a focused closure. They do not establish
that every relevant requirement was reviewed. Explicit broad slice requirements
are parent requirements, including draft and unclaimed declarations; automatic
slice applicability is not inferred. Request the slice's actual design fields,
criteria, obligations and cases together when reviewing its saved design.

`for_changes` explicitly requests a current write context alongside needed
meaning. The answer supplies its revision once in `contexts`, keyed by public
unit. Frozen assignments and review sources supply no current write revision.
Reading executes no test, proof or save and grants no credit.

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

The complete reader contract is [Wiki reader](workspace-read-wiki.md).
`workspace_read_wiki` accepts `{reads:[Read,...]}`, including length one and mixed
kinds. Each Read names exactly one `subject`, `search`, `assignment:true` or
issued `reference`, with optional `select` and `for_changes`. A known subject
accepts a selection directly. The ordered `results` answer each requested read;
an independent failure does not discard successful members. Complete requested
meaning needs no subsequent read.

Selections use public identities or authored meaning. No row, compiler, hash or
positional address is a public selection. The server resolves associations under
the selected source and authority; an agent does not reconstruct joins or check
transport integrity. Required definitions accompany meaning, shared once within
the same source scope. Optional details contain task meaning only.

Concrete `next_calls` carry usable bulk continuations. A complete choice
population may instead declare `selections` and one `selection_context` template
with common bindings; do not duplicate the same navigation per row or in another
array. No first item is selected by default. Empty, absent, ambiguous, refused,
unavailable, moved and historical information remain distinguishable.

### Source authority

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
read. Contract selections report captured source absence explicitly, distinct
from an empty established population.
An unavailable or invalid store is a source failure, never an empty contract.

Native controlled-contract failures preserve their owner code, cause and
details in the corresponding ordered result issue. Filesystem failures retain
the deciding cause, source path and
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

Every refusal of the findings-source resolver reaches `workspace_read_wiki`
with that resolver's own code and subject: an unauthenticated session, a missing,
duplicated or mismatched binding, and an unavailable or unreadable materialization.
Documents, canonical DEC and IN records and search read the
authenticated source root after the request's authentication.
### Choosing and reading saved meaning

Contract selections use `{contract,where?,include?}`. Omitting `where` requests
the complete authorized population. `requirements`, `verifications`,
`collections`, `cases`, `obligations`, `criteria`, `references` and `coverage`
are supported populations. `where` uses the shared semantic selector grammar;
returned selectors bind directly to dependent saves under their owning grammar.
`include` requests `verifications` and/or `dependencies` alongside a declaration.
The complete selected declaration and necessary definitions are preserved.

Requirement choices accept a nonblank lexical `query` containing caller words;
all terms match literally in the declaration's authored scalar values, ignoring
case. Omitted query requests the full inventory. Choice rows omit unchosen
rendered definitions and assignment bodies. Slice choices retain every public
unit and enough authored title, scope, work-kind and heading meaning to choose.
Identical descriptions remain ambiguous; order supplies no applicability.

Fields, scope directories, tasks, document sections, guidance, entries and
history use the same envelope. Declared field and entry bindings select exact
saved meaning. Structured entries use named object members or authored array
patterns; a full selected node omits the directory already used to choose it.
Entry/version references remain immutable material references after later edits.
They carry no target write authority or revision. A successful complete read
recommends no duplicate acquisition.

Guidance can be selected directly by a known topic. Complete selected topics
retain their instructions and callable related details. Vocabulary relations
carry allowed positions and signatures; their definition calls provide the
canonical meaning and applicable upstream operations. A selected case family
includes its complete constraints, targets, examples and falsification support;
no family is guessed. Package-document reads use the package serving owner and
never substitute workspace content.

### Save input contract selection

`for_changes` belongs on a Read. Its explicit member list requests a current
writable unit's revision and fitting owner-registered schema calls in `contexts`.
Ordinary content reads omit write revisions and authoring menus. Frozen,
historical, worker and ungranted sources cannot issue current write contexts.

A returned `select:{input_contract:{tool:"save_record",members:[...]}}` reads
exactly those members from the receiving tool's registered schema. When an owner
has coherent smaller scopes, an explicit choices view offers those scopes and
one complete whole-member schema call. Follow the relevant returned call; do
not expand every branch automatically. Requested members may span authoring jobs
in one call. Unavailable registration or permission remains unavailable or
refused, rather than a reader-authored substitute schema.

#### Navigation to the selection

A malformed save may return a schema call for its known authored members while
retaining the deciding validation cause. The caller corrects its own authored
values, then saves with the current revision. A stale revision offers a bulk
current-context read for the intended changes. Successful saving requires no
schema reread, assessment or verification merely because those readers exist.
Creation schemas similarly come from their registered owning tool; reading
one creates no record and invents no required caller choice.

### Reader corrections and observations

Review-purpose and terminal-review-designation facts describe saved meaning;
they grant no admission, launch or lifecycle authority. Contradictory saved
purposes remain integrity diagnostics rather than inferred defaults. An
initiative action selects one exact public unit or action. Its calls are
validated against the receiving role's registrations; missing caller values and
unavailable capabilities stay explicit. Dispatch preview remains distinct from
contract assessment and launches nothing.

Canonical source validation retains the native cause, affected subject, complete
schema constraints and diagnostics. Grouped diagnostic reasons preserve every
affected public subject and exact field address. A read repairs no source. If no
supported correction can acquire valid saved meaning or a current authenticated
revision, it states that boundary and offers no unchanged retry.

Create/save and candidate/publication/landing originals delegate to their
authenticated producing owners. Reading an original replays no effect. A save
receipt grants no saved-record selection: that misuse refuses with
`selection_not_granted`. When the receipt owner authenticates the selected unit
and the role permits it, the correction reads the requested supported selection
directly from that unit with `{reads:[{subject,select}]}`. It never substitutes
receipt content or replays saving. Unknown, foreign and unauthenticated receipts
retain their own cause and gain no broader recovery.

Work-unit roots and slices have no `field:"record"` selection. A refusal names
applicable fields and their exact binding, with a bulk field-inventory correction
when granted. An initiative's whole-record selection remains its own meaning.
Neither route silently selects another field for the caller.

## Proof discovery and code-index selections

`workspace_find_proofs` called with no arguments browses the catalogue when
catalogue discovery is the task. A held name/query goes directly to its read/search
without preliminary browsing. An available population is complete; if individual
definitions are unavailable, `availability` explicitly reports the partial
population, available/unavailable counts and each failed proof's identity and
specific cause. Healthy choices still use the returned selection form. Failed
definitions have no selectable meaning. A partial search covers only available
definitions; zero available matches is not a complete no-match answer. An
entirely unavailable population refuses, rather than returning an empty
successful index. Healthy focused reads omit unrelated failures. Root metadata
and source-generation failures still stop fresh acquisition.

A browse returns every available listed proof once, in the
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
the retained original and is never executed or substituted for it. A requested
part is always an object with `kind`, not a string. Malformed fresh and retained
requests are diagnosed against the form established by their supplied selectors;
supported fields are not reported as unknown because another union branch rejects
them. Part diagnostics select the supplied kind and report each deciding shape
constraint once. A supported standalone kind string such as `"authoring"` stays
invalid but can offer a separately validated `{kind:"authoring"}` correction,
preserving every other argument and any retained result binding. Missing names,
constraint refs, unknown fields and conflicting forms need explicit caller
choices; no field or binding is silently dropped. An optional
`query` instead returns complete lexical matches by tier, or bounded
counts with one exact call to the complete retained index. A complete catalogue
or index also
carries `short_descriptions`: one catalogue sentence of at most 120 characters
for exactly the listed proofs, keyed by proof name and empty when nothing
matched. The sentences are navigation prose for comparing candidates; they are
retained verbatim with the original, never searched or ranked, and add no
guarantee or execution capability. Complete selections
default to the overview: assertion, exclusions, capability and fit limits,
with an exact optional authoring call. Comparison help is independently optional:
request `part: {kind: "comparisons"}` or follow the returned comparison call.
It names actual alternatives and their exact retained/current reads, without
registry joins or a repeated definition. The overview also carries the exact catalogue `short_description`
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
acquisition refuses the mixed population. Repeating the same fresh request in
that loaded generation cannot repair it; acquiring a coherent server generation
is outside this MCP route. Authenticated retained meaning is still readable.
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
is explained; routine selection-origin bookkeeping is omitted. An unknown explicit
family refuses with `target_family_unknown`, retaining its rejected value and
offering the supported families by runner, source suffixes and selector fields.
The recovery form is non-executable: its known arguments preserve the query or
proof name and part, and `target_family` remains a caller choice. It recommends
no family-free retry; query recognition does not replace the rejected selection.
An ambiguous query offers discriminating fresh query-context choices. A family choice carries no
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

Authenticated findings questions use the launcher's bound review checkout,
including a saved design's separate supporting checkout. Matching content needs
no additional read. Differing indexed meaning is supplemental: small exact code
arrives as `reviewed_files`; larger content has a `read_reviewed_source` call on
the same tool. Its issued source binds complete file or absolute line selections
to that review run. Retained reads execute no query or refresh and preserve their
captured bytes after source movement. Missing exact content keeps its specific
cause and limits dependent conclusions; it does not authorize a replacement
checkout. See [code questions](mcp-repository-model.md#code-index-reads).

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
complete detail offers no self-read. Delivery inspection may keep a currently
eligible action without requiring inspection. A default summary's member
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
and one shared selection binding within the same immutable version. Object keys and authored array-member patterns are semantic path segments,
never array positions or generated row identities. `path` comes from these calls; `full:true` reads the complete selected node. Atomic
values and arrays without unique named rows remain whole. Each answer preserves the selected authored content, version and immutable
original reference without unrelated root scalar context; `original`
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

An immutable maintenance receipt remains historical. Issued maintenance and
operation recovery selections observe the recorded attempt or execute only
its authenticated unfinished work. They do not replay the canonical mutation
or successful checks. An acknowledgment can be recovered only from the exact
authenticated operation evidence, including its issued key associations.
Missing or indistinguishable evidence remains a stop; an inventory cannot
reconstruct lost caller-local keys by row order.
Allocator-gap diagnostics retain the affected kind, gap classification, exact
missing count and enclosing identity bounds. They do not expand every missing
identity into the response. The lint verdict and completed save effects remain
independent, and reading this cause repeats neither save nor checks.

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
failure diagnosis. Authenticated live attempt and delivery choices use the same
complete semantic delivery admission when no retained source is present.
Only the permitted, already-produced task projection crosses that boundary;
no source bytes or bookkeeping become public. Other oversized observations
without an authenticated source retain their precise delivery limitation.

Competing worker attempts carry distinguishing original assignment meaning,
captured from the launcher's immutable assignment. A title is sufficient when
unique. Repeated titles use the required original summary, instructions, notes
or criterion facts. Current parent edits cannot relabel an older attempt.
Unreadable or indistinguishable task evidence states the selection limitation;
it supplies neither invented meaning nor a new execution authorization.

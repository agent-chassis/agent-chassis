# Wiki reader

`workspace_read_wiki` accepts `{reads:[Read,...]}`. A single selection is an array
of length one. Each read names exactly one source: `subject`, `search`,
`assignment:true` or an issued `reference`, with optional `select` and
`for_changes`. Known subjects accept selections directly; acquiring a context or
storage address first is unnecessary. The singular top-level envelope is not
served.

The shared discovery declaration in
`packages/wiki-core/data/tool-discovery/mcp-tools.json` describes this same
contract. Its first-call template binds the caller's known subject and chosen
semantic selection inside `reads`; repeat items to request mixed information.
Context or discovery is needed only for information the caller lacks. Metadata
projections and architecture views consume that declaration; they do not grant
session access or replace the registered request schema.

```json
{"reads":[
  {"subject":"work record","select":{"field":"sections.user_requirements"}},
  {"subject":"work record","select":{"contract":"obligations"}}
]}
```

Results correspond to requests in order, including duplicates. Each result is
`{status:"ok",value}`, `{status:"partial",value,issues}` or
`{status:"refused"|"ambiguous"|"unavailable",issue}`. A failed member does not hide
independent authorized results. Malformed outer envelopes refuse the whole call.
A complete answer can finish immediately; optional reading never makes another
read compulsory.

Malformed requests identify the affected fields and items and the usable input
form. Even a whole-envelope refusal diagnoses invalid supplied read items; it
executes none of them. Valid bulk envelopes keep authorized sibling results.
When structural placement is wrong or an already named form lacks a uniquely
determined required literal, the refusal can supply a validated current-schema
correction preserving its source, selection and constraints. The malformed
request itself is never accepted.
Missing or conflicting sources and selections require an explicit caller choice;
the reader invents no subject, drops no unknown constraint and chooses no default
selection. Diagnostics describe deciding causes without validator branch reports.
Union diagnostics follow the supplied value's type and recognized selection,
including required discriminators still needing a caller choice. Misplaced
selections retain their members and constraints in the correction; incomplete
intent receives the accepted fields and values inline rather than an unrelated
grammar read.

The role policy and source owners enforce access. The server captures a current
unit once per call and reuses its authorized source for prose and contract
selections. It promises no atomic snapshot across different units. Frozen review
and worker sources retain their launcher authority and confinement. Reading
executes no save, proof, refresh, launch or publication and grants no credit.

## Contract meaning

Contract selections use `{contract,where?,include?}`. Populations are
`requirements`, `verifications`, `collections`, `obligations`, `cases`, `criteria`,
`references` and `coverage`. Omitting `where` explicitly requests the complete
authorized population. Requirements are whole authored declarations, including
drafts, definitions and grouped statements; compiled assertions do not replace
that population. Broad slice requirement reads remain parent requirements, with
slice applicability not established. Associated obligation closure cannot
establish that every relevant requirement has been reviewed.

Selectors use caller-known authored meaning:

- `{kind:"requirement",match:{subject:{identity:{...}},...}}` selects a whole
  declaration. `{kind:"requirement",obligation:"OBL-003"}` selects the actual
  associated declaration set.
- `{kind:"claim",requirement:<requirement selector>,match:{...}}` selects a
  generated behavioral part by its authored statement.
- `{kind:"verification",requirement:<requirement selector>,match?:{...}}` selects
  a verification; omitting its match requires uniqueness.
  `{kind:"verification",case:"case-001"}` selects the established saved case
  association.
- `{kind:"collection",match:{kind?,purpose?,members?,absent?}}` selects an authored
  collection. Members use whole requirement selectors; sequence order remains
  significant for ordered sequences.
- `{kind:"case",id:"case-001"}` and `{kind:"obligation",id:"OBL-003"}` use public
  domain identities. `{kind:"entity",identity:{...},type_term?}` uses an authored
  entity identity.
- `{kind:"criterion",match:{text?,typed_identity?}}` selects exactly one saved
  criterion using at least one authored field. Only an actually authored typed
  identity is eligible. `{kind:"unresolved",match:{text,reason?,candidate_concept?,source_passages?,absent?}}`
  selects one saved unresolved fragment through the requirements population.
  `source_passages` uses the existing authored list of
  `{user_requirement,user_requirement_occurrence?}` bindings. Supply the complete
  list; each entry constrains its exact text and any supplied occurrence. Omit an
  occurrence only when it is not needed to distinguish the saved fragment.
  Returned selectors preserve explicit occurrences and distinguish unbound
  fragments with `absent:["source_passages"]`. Reordering fragments does not
  change selection. Passage state, public source and location remain in readback;
  a stale binding is selected as saved, never refreshed by reading or targeting it.
  Missing distinctions remain ambiguous; identical saved meaning has no tie-breaker.
  Its recorded exception and enforcement consequence remain with its meaning.

Patterns are nonempty structural subsets of authored fields. Scalars match
exactly; nested objects constrain supplied fields and arrays constrain the whole
array. Entity aliases do not replace authored identity. `absent:["field.path"]`
expresses intentional absence and cannot contradict a supplied field. Zero
matches, several matches and unavailable association evidence remain distinct.
Identical public meaning cannot be resolved by storage order, recency or a hash.
An omitted optional draft-obligation association and an explicit empty association
both establish an empty associated claim and verification set. Malformed associations,
unresolved saved bindings and unavailable source evidence do not establish emptiness.
The draft retains its authored meaning without invented coverage.
An unavailable obligation association blocks only selections that need that
association. Independent declarations and verifications remain selectable. Reads
of the defective obligation or a population containing it return known meaning
as `partial`, with its affected field, cause and uncertainty. The unknown
claim and verification set is omitted rather than reported as empty. Selecting
that set for dependent work remains unavailable until its saved association is corrected.

An obligation returns `claims:[Selector,...]`, directly reusable as
`changes.obligations[].claims`. A whole-requirement selector appears only when
all of that declaration's behavioral claims are linked. A grouped subset uses
`kind:"claim"`; explicitly linked verifications use `kind:"verification"`.
Mixed links remain mixed. An explicit verification link also makes its owning
declarations available through the obligation-associated requirement read;
that context does not add their behavioral claims to the obligation's links.
No separate lossy declaration-association representation is returned.

Saved selectors name the captured saved content. They never silently select a
replacement declaration submitted in the same save. Under the save owner's
grammar, a whole-requirement amendment can explicitly name its submitted
assertions with `replacement_key:"changed"`: `$changed` selects that complete
population, and `{kind:"claim",requirement:"$changed",match:{...}}` selects
exactly one submitted assertion. Its check retains a separate
`verification.key`/`$check` binding. Ambiguous submitted parts return meaningful
choices preserving the local key so a chosen selector is reusable in that save.
These bindings are write-only; reader requests use saved semantic selections.
Fresh readback returns the exact saved associations without local labels.
Other-unit uses remain unchanged, and unresolved retirement uses still refuse.
Successful saves require no readback; request one only when the task needs it.

This local obligation isolation requires a valid complete captured graph. A
malformed or dangling authored collection membership, or a missing semantic
reference definition, prevents that graph from supplying semantic selections.
The response preserves the specific cause, affected field and known authored
subject; absent correspondence stays unavailable. It reports no write effects
and the stopping condition when no supported semantic save can infer the missing
meaning. It exposes no compiler addresses and advertises no unchanged retry or
guessed repair. Independent record-field reads in the bulk request remain usable.

Bulk envelope acceptance does not establish that each requested item is granted.
Optional package-guidance calls must also satisfy the receiving role's published
request schema and the bound document selection. A role denied package-document
reads receives no such optional call; required correction guidance remains inline.
Missing or altered document bindings still refuse.

The shared source/resolver owns all associations. Its private row, claim,
constraint, verification and reference bindings never become agent selectors or
optional compiler-carrier reads. Returned selectors can serve dependent saves
under the save owner's grammar and current revision; reading grants no write
authority. Necessary definitions accompany selected meaning. `include` adds
`verifications` or `dependencies` when needed. Repeated identical required
entity definitions appear once in `shared`, identified by their natural authored
identity.

Supporting source bodies used to validate definitions are not part of ordinary
requirement or dependency delivery. Authored definitions, exact entity identities,
resolution limits and specific failures remain with the selected meaning.
`source_basis:"captured_checkout"` describes evidence captured from checkout
inputs; observed HEAD does not establish committed bytes. If the session has
a registered code reader for that repository, optional source
navigation asks `query_code_index` for the exact path and follows its own selected
content calls. That published source has its own revision and may differ from the
definition capture; it never silently replaces the earlier source binding.
Explicit source selections still return complete content.

A verification answer includes its method, verifier, observed/falsifying
statements and complete saved runtime declaration when present. The capture owner
applies saved case-derived runtime meaning before projection. An intentionally
absent declaration stays absent. An unresolved or unavailable association never
borrows another verification's binding. Complete selected meaning needs no reread.

Lexical discovery remains available through
`{contract:"requirements",view:"choices",query:"caller words"}`. Every term must
occur literally in the declaration's own authored scalar values, ignoring case.
No fuzzy applicability or transitive-definition search is inferred. Omitted query
requests complete choices; blank queries refuse. Choices preserve incomplete and
unclaimed declarations and lead through semantic selectors to selected meaning.

## Fields, tasks, documents and entries

Existing field, scope-directory, guidance, schema, search, entry/history and
literal-passage selections use the same `reads` envelope. Exact field values and
selected originals are delivered whole. Scope directories return immediate paths
and child choices; invalid saved scope is not an empty scope. Search offers
meaningful excerpts and exact passage bindings, with material corpus exclusions.
Complete inventories require no pagination or per-member opening tour.

Slice choices bind each returned `members[i].unit` directly to `subject` and the
needed authorized selection to `select`. Repeat items in one `reads` array for
related fields and contract meaning across chosen slices. Discover field choices
with `inventory:"fields"` when those choices are missing; request context only
for missing context information. A slice context is not a prerequisite for its
selected contents. Source binding and receiving-role restrictions still apply.

Tasks use `{inventory:"tasks",match?:{heading?,text?,absent?}}`. Document sections
use `{field:"body",view:"sections",match?:{heading?,heading_path?,text?,absent?}}`;
package sections use `field:"text"` from the advertised serving owner. Omitted
match discovers complete semantic choices; a supplied match selects exactly one.
Repeated descriptions remain ambiguous until authored meaning distinguishes them.
Section boundaries reuse the Markdown passage owner. Package reads never
substitute workspace content. No hashed member handle or first-item default is
served.

Structured entries use `{entry,version?,view:"structure",path?,full?}`. Path
segments are object member names or `{match:<authored pattern>}` for array members.
A directory omits unchosen bodies and unrelated root scalar values. `full:true`
returns the complete chosen value without repeating its directory. Missing or
ambiguous members return containing choices in the same immutable version.
Immutable entry/version bindings remain available for exact originals and
material attachment; they do not grant a current write revision.

## Editing, retained reads and failures

Authoring guidance starts at `{subject:{requirement_guidance:true}}` when the
needed topic is unknown. Its `selections` share one bulk binding;
`selection_context.topics` describes each topic's scope, when to use it and
overlap. Family choices include runner, languages, source suffixes and selector
fields. Capability descriptions explain the narrower shapes and combined
vocabulary choices. `capability_binding` binds any explicit union of published
capability keys to a supported topic, beyond the listed common scopes. These
are authoring scopes, not execution grants.

The entry offers existing family, capability and complete existing/birth schema
selections directly. A chosen family includes shared case semantics and all of
that family's target and falsifier instructions, so a general case read is
unnecessary. Whole topics and complete inventories stay available explicitly.
Combine the needed guidance and known-unit `input_contract` selections in one
`reads` call. Known topics need no discovery read; no family or capability is
chosen automatically.

Select `{input_contract:{tool:"save_record",members:[...],branches?}}` to read
the complete owner schema for the needed members and selected branches together.
Omit `view` for that full selection. `view:"choices"` discovers supported branch
choices when intent is missing; it is not a required step. Unsupported
`view:"full"` or `view:"schema"` requests are refused and can return a correction
that omits only `view`, preserving the source, members, branches and other
constraints. Missing members or unknown constraints still require caller input.

Each branch choice retains the whole requested mixed job. A branch refusal keeps
already-valid branch selections in the offered alternatives; it does not infer
create or update intent. Choosing a branch or the complete member schema can
finish grammar acquisition in one call. The reader projects the registered
authoring owner's grammar and never reconstructs its declarations.

`for_changes:["notes",...]` explicitly requests current authoring context for a
writable unit. `contexts` is keyed by public unit and supplies its revision once,
with the fitting grammar calls for all requested members together. Ordinary
reading supplies no current write revision. Frozen, historical and assignment
material cannot supply a current write context. Save still validates authority,
source selection, the revision fence and prospective dependencies.
Invalid `for_changes` lists identify every inapplicable or repeated member at
its authored array position and supply the applicable member choices inline.
No edit member is silently removed. Independent valid reads and authoring
contexts remain available. Offered schema reads are optional when requesting
authoring context; acquiring grammar is never required merely to obtain a
revision.

Concrete `next_calls` use the bulk envelope. Choice populations can share one
`selection_context` template instead of repeating navigation for every row.
Choices and successful reading authorize no subsequent effect. Retained reads
never replay the originating operation or silently replace the selected source.
Mutable-source movement offers authorized reacquisition of that same subject;
explicit immutable versions remain historical.

Failures preserve their specific cause, affected public subject/field, actual
known effects and uncertainty. Known corrections are directly usable calls.
Missing caller choices stay explicit. Empty established populations, absent
saved meaning and unavailable evidence differ. If no supported correction exists,
the result states the stopping condition; filesystem rescue, decoding,
agent-side integrity checks and unchanged retry loops are not recovery routes.
Missing documents and work records are absent subjects; invalid or unreadable
saved records are unavailable evidence. An unavailable reference does not prove
which subject it once named. An unissued or expired reference requires an intact
issued reference or the caller's known subject, with no fabricated same-source
call. Unreadable or corrupt retained evidence keeps its specific cause. A
noncanonical subject requires the caller to choose its intended accepted form.

Malformed selection structure remains refused. If its complete meaning maps
uniquely to the role's declared forms, the refusal returns a validated bulk
correction with the original source and all modifiers intact. Multiple explicitly
requested meanings can become several items in that same correction. No alias is
accepted, and completed siblings are not reread. When intent or constraints remain
uncertain, a permitted optional `discover_supported_selections` call exposes choices
for the same source. It is labelled as discovery, does not perform the requested
content read, and does not resolve or discard the original constraints for the caller.

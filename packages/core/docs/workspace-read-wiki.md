# Wiki reader

`workspace_read_wiki` accepts `{reads:[Read,...]}`. A single selection is an array
of length one. Each read names exactly one source: `subject`, `search`,
`assignment:true` or an issued `reference`, with optional `select` and
`for_changes`. Known subjects accept selections directly; acquiring a context or
storage address first is unnecessary. The singular top-level envelope is not
served.

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
  identity is eligible. `{kind:"unresolved",match:{text,reason?,candidate_concept?,absent?}}`
  selects one saved unresolved fragment through the requirements population.
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

`for_changes:["notes",...]` explicitly requests current authoring context for a
writable unit. `contexts` is keyed by public unit and supplies its revision once,
with the fitting grammar calls for all requested members together. Ordinary
reading supplies no current write revision. Frozen, historical and assignment
material cannot supply a current write context. Save still validates authority,
source selection, the revision fence and prospective dependencies.

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

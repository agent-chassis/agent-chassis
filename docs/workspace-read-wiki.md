# Wiki reader

`workspace_read_wiki` reads one selected source in the session's configured
repository. Exactly one of `subject`, `search`, `assignment:true`, or a returned
`reference` selects that source. A reference grants no authority. The role policy,
source owner, frozen assignment/review source, and registered receiving schema
continue to decide access and acceptance.

## Answers and choices

Initial context returns a source identity, a short authored description where
present, and the choices needed to acquire further meaning. Saved-unit authoring
context preserves the current combined write revision. Source hashes,
authentication, successful checks, retention bookkeeping and byte accounting are
server-owned, not optional agent reading tasks.

`next_calls` contains concrete calls. A choice population may instead declare one
`selection_context` template and common bindings for every member. A WK context's
`selections` are complete selectors: choose one and call
`{reference,select:selections[i]}` using the returned reference unchanged. A
selection already expanded into a concrete call is not repeated in `selections`.
Inventory bindings explicitly name the member values used in the request. A
schema's accepted selector alone is not a discovered choice.

Choices are not a sequence or a permission. Entry and slice inventories select
no first member for the caller. Ordinary record context likewise recommends no
first detail read merely from its storage order; a bare subject names no task.
Explicit focused-edit context still selects the requested schema job. Exact
fields and completed meaning reads finish
without recommending a duplicate read or unrelated parent/sibling discovery.
Parent context identifies unread slice design; reviewing a parent does not read
its slices. A requested parent review discovers the complete slice inventory and
opens the members in its review scope, including non-first members.

## Search

Ordinary search returns discriminating choices with excerpts and exact source
bindings. `search:{inventory:true,...}` returns all matching choices directly,
without pagination or the unchosen full bodies. An ordinary preview with omitted
members offers the complete inventory call. A chosen passage opens through the
shared binding `{reference:{ref:members[i].source.reference},select:{field:"text"}}`
(or `results[i]` for a preview). That selection delivers its complete exact text.

Each supported hit also offers a concrete context call for its saved record or
document. A canonical record hit may open parent context, from which slice
identities and assignments are discovered. An immutable entry passage and the
saved unit's current context are different observations. Entry/version identities
remain explicit; historical content does not grant a current write revision.

Search reports material corpus exclusions and source limitations. Successful
index reconstruction and hashing mechanics do not qualify an otherwise complete
answer. A failed corpus read is an unavailable search, never an empty result.
Movement of a Markdown or canonical JSON passage offers the same source's current
context when that source kind is granted, then requires a new selection.

The `currentness` selection compares the original observations of canonical WK
records, including populations larger than 100, in one server-completed answer.
It does not establish Markdown, DEC/IN, entry-version or whole-corpus currentness.
An empty supported observation population says `state:"not_checked"` explicitly.
An entirely current population answers `state:"unchanged"` without returning its
successful comparison inventory. Changed, absent and unreadable subjects appear
once in `affected`, preserving their specific diagnostics. Mixed movement and
unavailable sources answer `changed_with_unavailable_sources`; unavailable
evidence is never reported as unchanged. Only changed readable subjects offer
current-context calls. Every captured observation is still checked server-side;
internal batches, digests and successful checks are not agent tasks.

## Assignment and contract meaning

Saved field discovery names the actual owner and presence of the field. A slice's
`sections.user_requirements` is parent-owned; its inventory and selected value
agree. Planning facts are readable independently of editing grammar. Fields
registered for both editing and planning appear once in the inventory.

Context exposes criteria, references, obligations, cases and complete coverage.
Associated review meaning keeps the selected unit's obligations and their
requirement, verification, definition, reference, case and criterion closure. It
does not establish that a reviewer has seen every relevant requirement.

Broad slice requirement discovery remains the parent requirement population,
explicitly labelled with slice applicability not established. It preserves draft
and unclaimed requirements. The reader does not infer applicability from an
obligation mapping or remove global notes/residue that lack an applicability map.

Requirement summary returns states and counts, not a byte-budget-filled subset of
rows. Its `selection_context` declares the requirements `choices` query template:
reuse its reference and select, then supply the caller's own nonblank `query`.
For example, `select:{contract:"requirements",view:"choices",query:"hierarchy jobs"}`
returns every matching choice in source order. It does not first read a full
inventory or automatically read the first match. Omitting `query` explicitly
selects the complete choice inventory; `identities`
supplies complete row, constraint, claim, verification and collection identities.
Both supply a shared row-selection template for row, verification or definition
dependency detail. `definitions`, `unresolved` and `compiled` are explicit complete
details. Verification answers do not send the caller back to an already read row.
An aggregate unresolved-scope marker is incomplete knowledge, not zero unresolved
meaning. Response delivery completeness and semantic extent remain distinct.

Requirement queries split on whitespace and lowercase each term. Every term must
occur literally within at least one scalar value of that row's own authored
statement: subject identity, modality, relation/constraint operands, applicability,
membership, lexical scope or definition input. Terms may match different values.
Punctuation and quotation marks are literal characters, with no regex, phrase,
synonym or accent-folding syntax. Storage metadata, rendered vocabulary and
transitive definitions are not searched. The response preserves the exact query,
matching rule, authorized population count and complete match count.

Choice descriptions retain subject and constraint distinctions. Defining rows
identify their subject/relation and mark their body as `selected_row`; the chosen
row supplies the exact definition body. Identical descriptions remain explicitly
ambiguous. Draft and unclaimed rows remain searchable. A slice query uses the
same parent requirement population with applicability not established; a managed
worker still sees only its authenticated assigned population.

No lexical match is distinct from an empty present population, absent source and
an unavailable source. No match establishes nothing about applicability. A
zero-match response supplies the caller-query template for refinement and a
concrete complete-inventory option, without returning unrelated rows. Blank,
non-string and wrong-view queries refuse specifically and never become implicit
full inventories. Queries issue no write revision and preserve existing frozen
source, movement and role restrictions.

Case readback preserves every selected-unit obligation mapping, including
obligations without cases, the criteria and referenced component definitions.
Source presence, mapping absence, empty population and incomplete meaning remain
distinct. A source-absent case answer does not establish a complete assignment.

Workers start with `assignment:true`. Its concrete first call reads the full
frozen guidance; additional assigned-contract choices are optional and use a
shared selection binding. This changes no captured assignment content, required
parent prose, worker role grant or source restriction.

## Entries and retained selections

Entry inventories expose complete current choices and separate history
navigation. A history answer declares its own version-choice template. Native
owner paging and retired route calls stay internal. Selected entry material
retains its immutable version reference and material attachment binding; callers
choose the target unit and acquire its current revision and grammar before a save.

Structured entry directories supply names and authored row labels where recorded.
They do not include the preamble or scalar sibling values merely because those
values are at the root. A needed root scalar is available through its returned
member selection, just like any other member. An explicit `full:true` selection
returns the entire chosen value without repeating its directory of member names.
Arrays without named row identity state that focused member selection is
unavailable; their complete value remains an explicit `full:true` selection.
The exact original, including its entire preamble and all scalar values, remains
available through the immutable source binding. Reads do not invent positional
identities, reinterpret provenance or rewrite material.

A retained reader descriptor names a live source. Movement reacquires context of
the same subject explicitly, while a selected mutable-source read refuses.
Explicit immutable entry versions remain pinned. Captured producer originals are
read only through their actual offered owner; reading never reruns a producer.
Receipt discovery offers a complete findings selection even when the compact
identity listing omitted findings. Captured effects and causes remain intact.

## Editing and failures

`{subject,select:{context:true,for_changes:[...]}}` returns only the selected unit,
current write revision, held-grammar identity, reference and one complete schema
call for all requested members. It does not carry ordinary reading menus or
unrelated authored context. Schema choices disclose only the selected members'
capabilities. Schemas retain reachable definitions, object constraints and
cross-member validation boundaries; reading grants no save authority.

Reader-owned selection refusals use `workspace-read-wiki-refusal.v1`. They preserve
the specific code, subject, cause, actual known effects and caller choices.
Known corrections are structured public calls accepted by the reader's full
request schema. Missing member choices have an explicit selection template.
Unavailable sources preserve the native diagnostic and responsible recovery
actor; no read repairs canonical or captured bytes. Native authentication and
retention refusals remain owned by the shared source owner. Unknown, foreign,
lost, corrupt and obsolete locators are never replaced with a newer source.

Missing focused capabilities, such as individual anonymous tasks or document
sections without source-owned selectors, do not authorize guessed IDs, filesystem
rescue, transport decoding or a broader read presented as mandatory recovery.

# Tool discovery surfaces

The production surface is the [task inventory](mcp-operation-reference.md),
advertised by MCP `tools/list` after initialization. Historical
`workspace_tools_list`, `workspace_tools_describe`, `workspace_search_repo`,
`workspace_read_page` and router registrations are not public endpoints in this
composition. This document does not authorize calling a private registrar or an
operator CLI when a session lacks a tool.

## Discovery surfaces

`workspace_read_wiki` is the compact-first entry for saved records, documents,
search, assignment and package guidance. Follow its returned reference and
selection for complete content. Selected input contracts explain the exact
create/save grammar of the record kind or saved unit, including the members the
caller actually needs. Read an exception contract explicitly through the unit's
reference with `select:{input_contract:{tool:"save_record",operation:"exception"}}`;
ordinary drafting does not choose an exception for the author.

Creation and save contracts state repeated authoring shapes once in local
`$defs`, including typed operands, lexical bindings and runtime-verification
members. Each selected contract includes its complete reachable definitions;
its members remain exact subsets of the authoritative kind schema, and its
source digest identifies that complete owner schema. Sharing changes neither
admission nor authored diagnostic paths.

`query_code_index` owns code-index questions: select a known symbol or file,
search an unknown name, or request graph impact for the caller's paths. Reuse
its returned retained-evidence source unchanged in a save. Historical graph
availability can coexist with unknown freshness; saving that evidence does not
establish current-source coverage or dispatch readiness.

`workspace_find_proofs` owns proof catalogue retrieval and selected assertions,
exclusions and family authoring guidance. Read a known name directly, search
with a query when the name is unknown, and browse when discovery is needed.
A uniquely identified family is neither a selected proof nor execution
permission. A listed candidate or lexical match establishes no proof credit.

`start_agent({preview:true,role:"worker"})` is a capability preview;
`start_agent({subject:<exact-unit>,preview:true})` assesses a selected action.
Neither spawns or grants launch permission. Read their checked and unchecked
populations. A bare implementation WK does not select an exact slice, and no
preview fills in scope, branch choice or proof meaning for its author.

An action preview leads with its subject, role, deciding controlled-acceptance
failure, readiness assessment and usable next calls. Checked and unchecked
conditions stay explicit. Worker action previews use the shared compact
capability projection: every plane's status is stated, and every unavailable,
unknown or stale plane retains its complete cause, blockers, authority and
recovery. Available-plane provenance is available through the returned
`capabilities.complete_retrieval` capability-preview call. That call is checked
against the serving contract and is read-only; its result is a current
inspection, not a historical snapshot or launch permission. Reviewer previews
retain their existing structured-dispatch-only projection.

Action-preview `capabilities.relevance` identifies this as general lifecycle
availability, separately from the action's readiness and deciding causes in
`assessment` and any top-level `controlled_acceptance_failure`. The retained
publication limitations describe publication capability; they are not an
acceptance-repair checklist. Publication remains explicitly unchecked. The
preview's `next_calls` continue to follow the deciding action cause, not an
unrelated capability row.

The requirements-comparison current read supplies a fresh revision and compact
source context. It does not promise complete `sections.user_requirements` text.
When `user_requirements_extent` reports shortening, follow that context's returned
`select:{field:"sections.user_requirements"}` call for the whole field before
comparing or correcting source meaning. Saved requirement-row detail is a
different selection and does not replace the complete source text.

`start_agent` emits the canonical `next_calls` list once. Its recommendation
flags identify the recommended subset of permitted actions; an unflagged
action is not thereby recommended. There is no duplicate `allowed_next_calls`
list. The canonical `controlled_acceptance_failure` appears once at the top
level. Equivalent copies are removed from nested readiness/diagnostic display;
different deciding facts remain explicit, with unvalidated calls withdrawn.
The retained original diagnostic is unchanged.

## Returned calls and selected originals

Responses identify their next call and allowed next calls. Follow authenticated
references unchanged, using the semantic selector their owning tool returns.
The server transports complete selected projections; agents do not reconstruct
raw logs, decode base64 or perform integrity checks as a retrieval job.

`workspace_read_wiki` selects canonical/authoring/candidate/publication originals;
`get_run_result` selects run/test/proof/delivery/integration originals. Reads
execute no tests, repeat no authoring and integrate nothing. Missing or corrupt
retained evidence has its own cause and must not become an empty successful read.
See [selected responses](mcp-selected-response-details.md).

## Review result discovery

`start_agent` is the callable start route for findings-only work. Original review
text is advisory evidence returned by `get_run_result`; schema adherence is a
separate formal-attestation fact. An unknown old monitor or unavailable
attestation neither invalidates text already received nor authorizes another
review, evidence append or reauthentication.

The coordinator applies repository review policy and saves the resulting
judgment. Only explicit `integrate_work({delivery})` reaches integration;
completion, observation and disposition are not substitutes. Configured CCE
policy and exact-delivery mechanical checks retain their separate owners.

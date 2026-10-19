# Record creation responses

`workspace_create_record({kind,title,initial?})` creates one caller-authored record
in the session-bound repository. Public kinds are `work_item`, `initiative`,
`decision`, `source` and `area`. Source creation requires actual source metadata.
The serving role and tier continue to govern availability and authoring authority.

Choose the kind and author the requested initial meaning. The published declaration
or previously acquired compatible grammar may suffice. When nested grammar is
missing, read `workspace_read_wiki({subject:{record_kind:<chosen kind>}})` and follow
its selected input-contract call for the needed members. Reading grammar is optional
and establishes neither authoring authority nor a record revision.

A clean response acknowledges creation and carries the issued unit, a save revision
for work items/initiatives/decisions, and any issued request-key bindings. The request
has no result-intent selector: this is the minimal reusable handoff for a caller
continuing with an edit. Full records, authored content, assessments, successful
maintenance inventories and allocator/retention bookkeeping remain absent.

Creation may finish immediately. A returned subject read is optional current
context, not an instruction to verify success. JSON kinds use their canonical IDs;
sources and areas use document paths. A dependent edit uses the returned unit,
revision and relevant bindings with `save_record`, acquiring only missing or stale
context or save grammar. If maintenance observed that the created record moved,
the response withholds the obsolete revision and states that current context is
needed before editing, without exposing successful check details. Sources and
areas have no ordinary content-edit variant
in `save_record`; their maintenance retry support does not grant one.

Necessary bindings and diagnostics use authenticated complete delivery when they
exceed ordinary inline capacity; success does not require another read. Historical
reads return task meaning, never the private persistence carrier. If retention
is unavailable, the answer states the precise continuation limit rather than
suggesting guessed identities or a second creation.

If the entire acknowledgment or request-key mappings are lost, call
`workspace_create_record({recover:{request:<exact original creation request>}})`.
This is a read of authenticated retained operation state, not a repeated creation.
It works after restart and recovers issued identities/bindings where they were
retained. Several identical creations can match: their known effects and issued
subjects remain visible, with exact reads for subjects that distinguish one
operation. Choose the intended subject explicitly through the returned
`recover.unit` call; the server does not infer it from prose, row order or titles.
If the request and subject still cannot identify one operation, recovery stops.
Unrecorded or unavailable state leaves publication unknown; it is not evidence
that no record was created.

Invalid input returns addressed constraints and missing caller choices. An invalid
initial may offer its kind's read-only grammar route; envelope mistakes and
operational failures do not suggest grammar discovery. No correction silently drops
caller intent, substitutes a kind or supplies source metadata. Confirmed
nonpublication issues no created identity. An area collision names the existing
document as `recovery.subject` and offers its exact optional read. The caller may
use that area if it meets the request or choose a distinct title for a new area;
the server never invents the title, overwrites the existing area or advertises an
unsupported content edit.

Known publication remains `created` after later failure. Specific causes, remaining
maintenance problems and uncertain participant effects stay immediate. Failed
maintenance carries its deciding findings and native cause, omitting nonblocking
warning inventories in both inline and retained answers. Independent cleanup
failures preserve their operation, code and message; generic diagnostics do not
repeat an identical cause. A returned
`save_record({unit,maintenance_retry:{save_result}})` call uses the authenticated
creation receipt and runs pending maintenance without repeating creation. Resolve
the reported cause before retrying. The immutable producer receipt predates checks;
reading it does not establish a current maintenance verdict. Busy maintenance
offers `save_record({unit,maintenance_observe:{save_result}})`, which reads current
retained progress without executing checks. Retained completed checks survive
coordination/index loss and are not rerun merely to repair bookkeeping.

Known publication failures retain authentic issued mappings even when allocator
publication or readback subsequently fails. An unavailable write revision remains
unavailable; the supported current-subject read supplies context when needed.
Pending maintenance can have its own authenticated remainder call. Recoverable
artifact cleanup uses its retained subjects and the existing reference-safe owner;
completed checks and canonical publication are preserved. An executor exception
after completed checks with no retained cleanup action remains a precise unsupported
repair, rather than an invitation to rerun successful checks.

If publication is uncertain, the answer says `unknown`, marks any candidate as
unconfirmed, and offers only an available same-subject read. That read can establish
current content, not necessarily this operation's complete settlement. A missing
authenticated maintenance receipt with no recoverable retained operation state
has no supported retry route. Operations predating request-bound retention cannot
be found through the new request lookup. Neither condition authorizes another
birth: identical valid input can create a different record.

# Landing-status task responses

`workspace_check_landing` observes one WK in the bound session repository.
Orchestrator and operator sessions have access. It publishes, repairs, merges
and closes nothing. Tool availability and returned calls grant no new authority.
The underlying observer, authentication and effect owners are described in
[terminal review](mcp-dispatch-terminal-review.md#handoff-destinations-and-landing-observation).

The closed request is `{subject, selection?, detail?}`. The optional
`detail: {member: "landing_action"}` requests the human instructions as part
of this observation. Omitting `detail` asks only for status; it does not request
all available instructions. This selects response meaning, not permission to
land or change a publication. Omitting `selection` asks about
the publication resolved from the current candidate at invocation time. Exact
intent requires the complete owner-issued publication selection, copied
unchanged. Destination strings and proposal numbers are equality selectors,
not provider configuration. A failed explicit selection remains explicit; a
current-status alternative is a separate question and is not a correction.

The default answer states `accepted`, the repository/WK `subject`,
`request_mode` and the observed `state`, or a specific `blocker`. `accepted`
means the observation ran; it does not mean the publication landed. The public
task omits successful checks, authentication carriers, ancestry inventories,
routine cache effects and retention bookkeeping. The underlying semantic
observer and authenticated retained bindings keep those facts internally.

- `landed` is a complete answer and offers no required read or continuation.
- `awaiting_human_landing` identifies the landing actor. With
  `detail: {member: "landing_action"}`, the answer includes the complete action
  directly when the actionable answer fits the ordinary delivery bound, even
  if a retained reader exists. It offers no redundant action read.
  For a status-only request, an optional
  `next_calls` entry with `purpose: "landing_action"` reads the retained human
  action through `workspace_read_wiki({reads: [{reference}]})`. It adds the exact Git
  head/base/ref or remote/branch, or the hosted proposal number, destination
  remote, exact head, base and proposal URL supplied by the observer. The hosted
  action's head identifies the publication to land; a proposal number alone cannot
  preserve intent when that proposal later publishes a different head.
  Larger requested instructions use the same authenticated selected read;
  that read has `recommended: true` and is needed to finish the action request.
  A status-only optional read
  remains optional regardless of its size. Neither route repeats observation.
- An authenticated pending publication offers `observe_later`, an exact
  `workspace_check_landing` call admitted by its serving request schema. This
  is an optional later observation, not a polling instruction. The caller
  need not reconstruct its selector. It preserves the requested action detail,
  as do conditional retries after a correction. Private compositions without a
  serving call retain the issued selection as data and advertise no unavailable call.
- `contradictory` and `unavailable` preserve the specific cause and any
  producer-established recovery. Lookup failure does not prove a contradiction
  or that the publication never landed. An unauthenticated explicit selection
  is identified as such and is never replaced with current status.
  A completed negative ancestry observation survives later loss of current
  eligibility as `observed_landing: {state: "not_landed"}`, beside the distinct
  eligibility cause. That fact supplies no current action or recovery authority.
  Closed unmerged hosted proposals preserve their observed state, merge status
  and URL consistently in current and exact modes. Pending hosted proposals
  with an observed merge impediment include `landing_impediment` and its URL;
  merge readiness remains owned by the forge and landing actor.
  The diagnosis flattens repeated cause wrappers and reports distinct native
  `failures` once, retaining differing codes, messages and implicated refs or
  observed heads. Branch-observation and forge-probe failures retain their
  native deciding causes; authored proposal text is not failure evidence.
  It does not expose capture inventories or recovery-owner prose.

The optional action read authenticates the original role, repository, route and
WK binding before serving task meaning. It returns the saved status and human
action, not internal carriers, a new observation, or another self-read. It
does not require an observer adapter and remains historical after live state
moves. Missing, foreign or corrupted references refuse rather than refresh.

Recovery names an established actor, prerequisite and action. A
`retry_after_correction` call appears only when the original observation call
is usable and its producer established a responsible actor and prerequisite.
It is conditional on that correction; it is not an unchanged retry. If no
correction was established, `recovery.stopping_condition` states that no
supported correction call is available here. The observed state and cause
determine what is known; a missing correction does not make known facts unknown.
It supplies no placeholder prerequisite or unchanged retry. No publication or
candidate advancement is inferred as recovery.

Acquisition uncertainty, completed acquisition followed by observation failure,
and unknown adapter effects remain explicit. Separately selected or larger
pending instructions use a task-detail source. Fitting requested instructions
and complete status answers need no response storage; a status-only answer
retains available instructions only to support their optional selection.
If this retention fails, delivery uses the acquired answer without repeating
observation: requested instructions remain requested and status-only stays
status-only. Oversized content remains subject to the existing whole-response
delivery and refusal boundary. Only the retention operation's modeled refusal
uses this path; authentication or projection failures are not caught as
retention failures. Raw process output, capture inventories and server
authentication metadata are not detail content.

Historical exact reads can establish landing, but pending still requires current
applicability. Changed destination configuration is not
permission to select a different provider. These limits do not authorize
repair, publication or merge.

# Landing-status task responses

`workspace_check_landing` observes one WK in the bound session repository.
Orchestrator and operator sessions have access. It publishes, repairs, merges
and closes nothing. Tool availability and returned calls grant no new authority.
The underlying observer, authentication and effect owners are described in
[terminal review](mcp-dispatch-terminal-review.md#handoff-destinations-and-landing-observation).

The closed request is `{subject, selection?}`. Omitting `selection` asks about
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
- `awaiting_human_landing` identifies the landing actor. When the observer
  supplies an action target and the serving reader is available, an optional
  `next_calls` entry with `purpose: "landing_action"` reads the retained human
  action through `workspace_read_wiki({reference})`. It adds the exact Git
  head/base/ref or remote/branch, or the hosted proposal number/base supplied
  by the observer. Without a composed reader, the action is returned inline.
- An authenticated pending publication offers `observe_later`, an exact
  `workspace_check_landing` call admitted by its serving request schema. This
  is an optional later observation, not a polling instruction. The caller
  need not reconstruct its selector. Private compositions without a serving
  call retain the issued selection as data and advertise no unavailable call.
- `contradictory` and `unavailable` preserve the specific cause and any
  producer-established recovery. Lookup failure does not prove a contradiction
  or that the publication never landed. An unauthenticated explicit selection
  is identified as such and is never replaced with current status.
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
and unknown adapter effects remain explicit. Only a pending action with a
composed detail reader needs a task-detail source. A complete answer that fits
the ordinary delivery bound requires no response storage; larger diagnoses keep
the existing authenticated whole-response delivery boundary. If that optional action cannot be stored, the answer supplies
the complete action inline and the same usable later-observation call. No task
information is withheld, so there is no response-storage recovery step.
Only the retention operation's modeled refusal uses this inline path;
authentication or projection failures are not caught as retention failures.
Observation is never replayed to deliver an answer. Native observation failures remain immediate;
raw process output, capture inventories and server authentication metadata are
not detail content.

Current lower-owner limits remain visible in the task's behavior: hosted
pending action targets contain proposal number/base but no proposal URL or
merge-readiness impediment. A closed unmerged hosted proposal may be reported
as contradictory in current mode and unavailable in explicit mode. Historical
exact reads can establish landing, but pending still requires current
applicability. A known not-landed observation can be lost when a subsequent
current-applicability check fails; preserving that fact requires the shared
observer to supply it separately. Changed destination configuration is not
permission to select a different provider. These limits do not authorize
repair, publication or merge.

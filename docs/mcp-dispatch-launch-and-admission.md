# MCP dispatch launch and admission

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
supported families, launch and monitoring, the canonical initiative gate,
orphaned and ahead slice tips, and declared unit dependencies.

Sibling pages: [managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## Registered start task

`src/lib/task-start-agent-tools.mjs` in wiki-MCP exports
`createStartAgentInputContract(z)` and `registerStartAgentTool({registerTool, z,
workspace, sessionEnv, responseEnv, dispatchContext, buildResultCall,
requestContracts})`. Importing them registers nothing. The production composer registers
`start_agent` with the same backend used by result observation and integration.
The registrar supplies the refined `inputSchema` and separate
`advertisedInputSchema`; production registration and orchestrator role grants use that contract.

The closed request has three forms: `{subject, role?, app?, model?,
diff_base_sha?, reviewed_sha?, preview?:false}`, the same subject-bearing request
with `preview:true`, and `{preview:true, role, app?, model?}` for capabilities.
Capability preview requires an explicit `worker`, `reviewer` or `redteam` role
and requires no subject. For example, `start_agent({preview:true,role:"worker"})`
and `start_agent({preview:true,role:"reviewer"})` inspect configured capabilities.
`{preview:true}` reports missing role; `{}` reports missing subject for normal
start. Registered validation and direct preparation retain native validator
issues and offer schema-checked role calls as unselected choices.
Normal start needs only the canonical subject; saved dispatch intent and model
configuration supply omitted choices. A complete SHA pair selects review material
and is forbidden for workers and subject-free previews. Unknown members, including
repository, prompt, credentials and lifecycle carriers, are refused before effects.
The trusted session selects caller authority; child `role` grants none.

Managed worker implementation requires an exact slice, for example
`start_agent({subject:"WK-0001#SLICE-001"})`. The backend routing owner applies
the configured target restriction to both selected preview and real start.
A bare parent worker request reports `managed_worker_exact_slice_required`;
select an existing implementation slice or author `changes.ready_slices` through
root `save_record` with the current revision and caller-supplied contract. The
required selection, scope, acceptance and proof meaning are authored inputs,
so this guidance is not a complete executable save or start call. For an
available root, selected preview and real start both keep that refusal, report
`assignment_authoring` (`slice_required`, `changes.ready_slices` on the root,
caller-authored values) and return one `workspace_read_wiki({subject:<root>})`
guidance call in `next_calls` and `allowed_next_calls`; the launcher's own
recovery states `choice_required`. The read returns the root's slices and
current revision and changes nothing: the same request refuses again until the
caller starts an exact slice. No save or start call is offered, and no slice is
selected for the caller, including a sole existing one. When the root is
unavailable or this server cannot serve that read, the refusal stands with no
call and names the cause in `readiness_guidance_limitation`. Parent targets
remain available for applicable findings roles and their existing material
requirements. No slice is allocated by preview or refusal.

`createStartAgentTask(configuration).prepare(request)` authenticates the session
through the existing source-context owner and permits only orchestrators. Trusted
composition binds one repository and `createPreparedWorkspaceAgentDispatchBackend`
with its real executors, conduit authority, provisioning and admission owners.
`dispatchContext` supplies `dispatchBackend`, `dispatchSessionIdentity`,
`launcherConfirmedNoCceAuthority`, `validateDispatch`, `validateLaunchIntent`,
`revalidatePrivateHandoff`, `generateGraphImpactEvidence`,
`refreshAdmissionEvidence`, `registeredToolNames`, `registerTool` and `isPaidTier`.
The task calls `createAgentDispatchPipeline` directly, preserving ordered readiness,
launch refusals and the existing single base-selection reassessment. Its trusted
accepted-outcome projector receives launcher facts before compact receipt delivery.

Action preview resolves canonical selection, readonly readiness, exact review
material and launch planning. It prepares no code index and writes nothing: a
graph-dependent worker preview follows the readiness owner's graph-dependency
decision only to report the committed graph as not assessed, and its cache effect
is always `not_consumed`. Capability preview uses neutral configuration/model selection, with no
invented subject and no graph/runtime preparation. Both disclose assessed and
unchecked populations; unevaluated CCE and launch-time isolation remain unchecked.
A `reviewer` preview, in either form, reports under `capabilities` the
enforcement tier and the one lifecycle plane a review starts through:
`structured_dispatch` is listed whenever it is anything other than available,
with its status, exact blockers, cause, gate outcome, recovery and corrective
action, and `planes` is empty while it does not block. It carries no other
plane, no `route_registration` and no wiring source or backend or protocol
generation; `selection.backend`, the public app and model selection, executor
availability, the supplied assignment's assessment, source, effects and
supported next calls are unchanged. An empty `planes` and `outcome: "preview"`
are availability facts, never launch permission. Worker and redteam previews
and coordination preflight keep every plane.
Worker previews check configured target eligibility and authored readiness, and
the readiness owner overlays the launcher's read-only worker scope preflight;
`assessment.execution_admitted` remains `unchecked`. The preflight report crosses
unchanged as `assessment.readiness.worker_scope_preflight`, and coverage lists
`prospective_scope_base` and `prospective_worker_scope` as assessed or unchecked
according to that report. For an unallocated WK the preview also returns
`base_selection`: the `root_unit`, the `branch`, `roles: ["wk_base",
"publication_target"]` because that one branch is both the base the WK is cut
from and the branch its work is published to, `selection`
(`saved_base_branch` when the root saves `base_branch`, otherwise
`defaulted_current_checkout_branch`), `saved`, and `information` prose. The
preflight `base` carries the same `selection` and `publication_target`. A
defaulted branch is the current symbolic local branch of the configured
repository checkout, observed at preview time. The preview writes nothing and
freezes nothing: actual start applies the same rule again, and the orchestrator
chooses another branch by saving `base_branch` on the root first. An allocated
WK returns no `base_selection`. When the root saves no `base_branch` and the
configured checkout has a detached `HEAD`, there is no default: the preview
stays `outcome: "preview"` and
reports `dispatchable: false` with
`readiness_decision_code: "scope_existence_base_selection_missing"`, the prior
result under `structural_readiness`, and the same root guidance actual start
returns: `correction` (`root_unit`, fresh `revision`, `required_choice:
"base_branch"`, `save_tool: "save_record"`, the original request as `retry`) and
one `workspace_read_wiki({subject: root})` call checked against the serving full
contract. A rejected or unavailable contract is reported as
`readiness_guidance_limitation` beside the unchanged diagnosis instead of a call.
That guidance supplies no branch value, and reading the root changes nothing; the
caller's `save_record` with `changes.base_branch`, or a checkout on a local
branch, clears the prerequisite. A
higher-priority readiness refusal keeps its own decision and receives no base
guidance, and an allocated WK is assessed at its existing WK tip. Preview still
does not prove a child can start.
Graph snapshot availability establishes source identity, not graph admission.
Without a snapshot, the canonical revision remains known and Git identities are unknown.
Neither preview launches, creates a run or integrates.

A worker preview of an exact slice whose readiness is
`controlled_acceptance_incomplete` keeps that cause: the same `outcome:
"preview"`, `dispatchable: false`, non-effects and `execution_admitted:
"unchecked"`. It adds one recommended guidance call,
`workspace_assess_contract({unit: <that exact slice>})`, in `next_calls` and
`allowed_next_calls`, checked against the serving registrar's full request
contract. The preview assesses nothing itself and repeats no completeness
calculation: the returned assessment names the slice's uncovered criteria and
the authored correction, and executes no proof and grants no credit. When this
server holds no assessment consumer, or its contract rejects the call or fails
to validate it, the preview returns `contract_assessment_limitation` (`code`:
`contract_assessment_consumer_unavailable`,
`contract_assessment_full_contract_rejected` or
`contract_assessment_validation_failed`, with `tool`) and no call. No base
`correction` accompanies this cause, a missing base selection keeps its own
guidance, every other preview outcome is unchanged, and actual start keeps
its own refusal. How a slice authors that coverage is described under
[Requirement-authoring guidance](acceptance-coverage-mcp.md#requirement-authoring-guidance).

The shared managed-lifecycle projection reads the serving registration set and
retained full request contracts: transport observes `start_agent`, validation
ownership observes `verify_proof`, and publication guidance identifies
`workspace_publish_work`. Retired registrations establish no current availability.
Transport availability also requires the backend's authoritative, fresh compatible
composition; registration alone establishes no admission, child start, proof
execution or credit. Other backend facts retain their own sources, freshness and
unknown or stale states.

Without an established executable correction, unavailable capabilities stay
explicitly unavailable. An accepted `workspace_read_wiki` call for this document
is informational inspection and repairs no infrastructure; its complete arguments
are checked against the serving full validator. Subject-free preview invents no
work unit or incomplete publication/integration call and offers no unchanged retry
as a remedy. Explicit `integrate_work` remains a coordinator action, and
`workspace_publish_work` is separate from automatic promotion: publication neither
merges nor completes a WK. Registration of either tool grants no caller authority.

Started responses require observed child-start evidence, preserve actual terminal
state, identify the existing run as `attempt_id`, and expose selected source and
launcher enforcement when its owner supplies it; otherwise enforcement is unknown.
Worker source names the frozen scope base; advisory
source names captured review commits/tree/material. Publication pending and cleanup
uncertainty remain producer-owned observations. Refusals retain owner diagnosis;
Result durability is unknown unless its owner supplies that fact.
absence of an effect field is not evidence that nothing happened. Workspace
creation/reuse receipts remain internal. Start and completion never integrate.

An authored readiness refusal preserves the selected subject, original decision,
diagnostic and authority limb. Its selected-unit `workspace_read_wiki` guidance
uses the serving registrar's schema authority through final refusal construction
and its retained full request contract, including refinements. Valid guidance
appears in the start response's `next_calls` and `allowed_next_calls`. Reading
obtains the current revision and semantic selections; it leaves the blocker
unchanged. Correct the authored fact through `save_record`, then reassess the same
subject. An unavailable or invalid read preserves the original blocker and names
the secondary serving limitation without offering an unchecked call.

Missing-base recovery names the root WK, its combined authoring revision, the
required operator branch choice and the same-subject retry. After that choice,
`buildStartAgentBaseCorrectionCall({correction, baseBranch}, z)` validates a typed
root `save_record` call using the existing save contract. It guesses no branch.

`buildResultCall({subject, attempt_id})` and `requestContracts.contractFor(tool)`
are trusted consumer bindings. Only a call accepted by its actual registered
contract is returned, without public repository input. If the real subject/attempt
consumer is absent or its builder fails, the response discloses that dependency
and emits no callable substitute; builder failure preserves the successful launch
and its original failure evidence separately. The production composer binds that reader and the same prepared backend. Owner-only
source and installed tests remain supporting evidence; public adoption is exercised
through the actual production server.

## Canonical slice start and existing readiness orchestration

Dispatch is "start this canonical unit". The caller names the unit; everything
the worker needs is resolved by the system:

- **The agent comes from the unit.** `role` is optional on
  `start_agent`. Omitted, the dispatch target is derived from the
  unit's own `dispatch_intent.intended_agent_role` by the wiki-core dispatch
  owner, so a caller never restates a fact the canonical record already carries,
  and can never restate it inconsistently. A unit that declares no agent is
  refused before launch, for action preview and actual start alike, with the
  derived-axis readiness refusal naming what the record is missing and with zero
  worker spawned. The refusal (`canonical_dispatch_intent_unresolved`) reports
  `record_available` and, for an available record, `assignment_authoring`: its
  `state` (`slice_required` for a parent, `slice_absent` for a requested slice
  the parent does not hold, `slice_intent_unresolved` for an existing slice), the
  `unit` whose `save_record` authors the assignment, and the `placement`
  (`changes.ready_slices` on the parent, `changes.agent_role` on an existing
  slice). Its one next call is the `workspace_read_wiki` read of that unit,
  checked against the serving registrar's full request contract. The read
  returns the current revision and changes nothing; the slice content, role and
  scope are the caller's to author, and a new slice is started by the identity
  its save returns. When this server cannot offer the read, the refusal keeps
  its cause with `readiness_guidance_limitation` and no call. An unavailable
  record is offered no authoring. An explicitly named role keeps
  today's selection exactly, which is what reviewer and redteam dispatch use:
  an advisory role is the caller's decision, not a property of the reviewed unit.
- **The assignment comes from the record.** Task, scope, acceptance, validation,
  selected material and runtime are resolved from the canonical slice and its
  parent together with authenticated launcher facts. A caller-authored `prompt`,
  `request`, `argv` or `env` is refused at the boundary rather than accepted and
  discarded, because accepting it would tell a caller its instructions took
  effect when the assignment came from the record. No sibling unit's material is
  injected, and frozen material is never replaced live.
- **Readiness is internal.** One ordinary start runs
  `orchestrateAgentDispatchReadiness`, the existing readiness owner, including
  the currentness and worker revalidation that start needs. There is no second
  readiness algorithm and no mandatory caller pre-call;
  `workspace_read_wiki({subject})` returns document context before an explicit
  start request.
- **Authority is unchanged.** Equivalent admitted inputs preserve the worker's
  read and write namespace, role and tier, completion transport and
  launcher-resolved runtime. Review material and reviewer launch identity stay
  launcher-owned, so a bare caller locator grants no authority. CCE alone decides
  policy, and mechanical refusals stay distinct from policy decisions.

## One advisory-review execution pipeline

`start_agent` selects reviewer and redteam requests by role before
worker admission, implementation lifecycle planning, persistent worktree
allocation, status/history inspection, receipts, recovery, integration, CAS, or
forge coordination. Both roles enter the same advisory-review owner; their role
presentations and tool profiles remain distinct and their mutation authority is
always empty.

A canonical WK or slice contributes coordination context. Current canonical
design bytes, an immutable implementation-slice delivery, a complete
`diff_base_sha` plus `reviewed_sha` pair, and a launcher-built terminal candidate
are material selectors for that owner, not execution routes. A SHA pair is
locator syntax, never authority. Each accepted action resolves immutable
material, creates a fresh action-private read-only materialization, invokes the
selected executor once, allocates an action-local run and monitor, and settles
its text-first advisory output. Clean findings, severe findings, and
schema-nonadherent text are equally usable; missing output or execution failure
affects only that action.

Formal attestation is optional and can be derived only while the same run
settles when the launcher-selected canonical result contract requests it. No
review result, status, history, provenance, attestation, or receipt authorizes,
vetoes, replays, replaces, or recovers another action. There is no legacy review
receipt, continuation, recovery, or replay route.

## Supported families

Confined Claude and Codex roles are supported when their runtime and bubblewrap
contracts validate. Worker, reviewer, and redteam sessions use the same R union
W namespace construction and write-scope enforcement; reviewers and redteam
have no writable repository paths. Claude preserves native-edit permission
settings and settings masking. Codex preserves its isolated runtime home and
launcher-generated configuration overrides. Agy remains unsupported and fails
closed.

## Launch and monitoring

`start_launch` validates readiness and starts the selected family executor
directly. `probe_run` reads the in-memory launcher run state directly. Run IDs
and monitor handles are launcher-minted correlation values and never accepted
as caller authority. Cancellation or any client, relay, host-server, or model
exit tears down the same per-dispatch lifecycle.

### The canonical initiative and parent review status gate dispatch

The canonical parent `IN-####` initiative is **mechanical ref identity**. The
launcher derives and verifies the exact `wk/IN/WK` and `slice/IN/WK` ref
namespace an implementation-slice launch commits into from it, so an
implementation-slice dispatch whose canonical parent declares no initiative, or a
non-canonical one, cannot name that namespace and is refused with the stable,
## One frozen worker assignment for every managed family

A managed implementation worker receives its complete assigned task, and both
supported families receive the same one. The launcher composes it once and hands
it to whichever family executor follows; neither family reacquires or re-renders
the canonical task for itself.

The path is:

1. **Capture.** The launcher-frozen worker scope snapshot carries the canonical
   record, the selected unit contract, and the selected assignment material. The
   material is resolved beside the scope freeze from the same authenticated
   canonical inputs, through the shared entry-material resolver, against the
   repository identity the dispatch route already resolved. Each referenced
   source record must be covered by the frozen resolved read and write
   membership at the scope-existence base, minus the launcher exclusions, as
   answered by the scope-tree containment predicate; the declared arrays are not
   reinterpreted, so a glob admits only records present at that base. The
   assignment's own record needs no grant, and a reference remains an identity,
   never a source permission. Its existing
   diagnostics — foreign repository, out-of-scope source, malformed reference,
   missing version, and the reference/byte limits — refuse the freeze, so an
   unresolvable assignment never reaches a family executor and no worker is
   spawned.
2. **Resettlement.** The existing pre-executor WK-tip resettlement may replace
   that snapshot, which repeats the capture against the newly settled canonical
   inputs. A superseded snapshot is never prepared or launched: only the final
   successfully validated snapshot reaches the provisioning wrapper.
3. **Preparation.** The managed provisioning wrapper prepares the assignment
   exactly once, after snapshot and provisioning authentication and before the
   private snapshot is stripped. Preparation is pure: it composes the canonical
   summary, the agent brief with the captured material, and the launch packet,
   and performs no record load, reference resolution, or admissibility
   evaluation. It renders the readiness the launcher already validated and
   forwarded, normalizing only the structural fields the shared prompt needs
   from the unit it is preparing; it re-decides nothing and adds no readiness
   veto, and an explicitly non-dispatchable readiness stays non-dispatchable.
4. **Authentication.** The prepared presentation is minted into one frozen
   assignment bound to the exact unit, canonical source digest, run id, monitor
   handle, and provisioned worktree. Only immutable presentation and identity
   cross to the adapter: the raw work record, the private controlled-proof
   carrier, and the provisioning ticket do not. A caller prompt, request field,
   or environment value can neither create nor replace it. The presentation is
   immutable all the way down, including the nested launch packet Codex reads
   its task bytes out of; preparation freezes only what it owns and never
   freezes or mutates a record, readiness envelope, or material object the
   caller still owns.
5. **Delivery.** Both managed adapters authenticate that value before any launch
   preparation. The client spawns with the assignment's startup text only; the
   assignment guidance is served through the worker's assignment-only
   `workspace_read_wiki` (see [Assignment retrieval](#assignment-retrieval)).
   A managed launch that arrives without the value, with a value it did not
   mint, or with one bound to another launch refuses before spawning anything.

### Assignment content

The prepared launch packet owns two sections: the startup text and the
assignment guidance. Direct delivery composes both into one prompt; managed
delivery spawns with the startup text, which directs the worker to retrieve the
guidance first. The two delivery modes intentionally carry different guidance:
the same composer selects each mode's content, and neither is a copy of the
other.

The startup text opens with one shared, family-neutral instruction. For direct
delivery it is: implement the assigned task, read only the listed readable
paths and modify only the listed writable paths, use the tools available in the
session, run `verify_proof` and report its result before committing,
and report a blocker when required work falls outside scope. Managed delivery
uses the same instruction without the listed-path sentence: the session itself
enforces which paths the worker may read and modify. One `Read your
managed-worker guide before acting: <path>` line follows, naming the
package-owned guide (`data/role-guides/managed-worker.md` in
`@agent-chassis/agent-launch-core`), whose directory the launcher grants
read-only; the guide defers execution and completion ordering to the runtime
instructions. In
managed delivery the instruction and the guide line are separated by the
first-read instruction: call
`workspace_read_wiki` with `{"assignment":true}`, follow every returned
continuation before other work, and report a refused read as a blocker. The
startup text names no family tool, confinement mechanism, or alternative
editing or validation route; the launcher-granted tools and confinement remain
the authority. The existing commit-then-result completion protocol follows
unchanged. Managed startup text carries no task body, material, or scope
inventory, so its size does not grow with the assignment or its scope.

Managed guidance carries the selected unit's operative content, each section
once: a concise record identification, the selected unit's complete summary,
its operative notes and tasks rendered verbatim, its acceptance criteria, its
readable and writable paths, its declared validation, and the explicitly
selected assignment material in its resolved root-then-selected order, rendered
by the agent brief's own material formatter. The summary, notes and tasks are
never truncated or summarized, and a sentence of authored task or material text
is never removed because it names a path or a permission.

The `Readable Paths` and `Writable Paths` sections present the selected unit's
launcher-authenticated scope: the resolved members the frozen assignment already
holds, not the authored declarations, rendered through the same selected-unit
projection and list formatting as direct delivery. Each list is complete and
without duplicates. Every writable path is also readable, so it appears in both
lists, and an empty list is rendered as `- None` rather than left to imply
unrestricted access. The lists are frozen with the rest of the assignment: a
later record edit changes neither the first read nor a reread. They describe
the scope and grant nothing. Scope exclusions and launcher-internal paths are
not listed, no parent or sibling scope is carried, and the bindings stay with
the launcher: confinement enforces filesystem access and the worker MCP tool
profile enforces tool access, so the worker gains no permission lookup. Managed
guidance does not carry dispatch metadata, readiness or derived-evidence
reports, or the agent brief.

A managed worker assigned a slice also receives the parent record's complete
`sections.user_requirements`, taken from the same frozen record as the rest of
the assignment. It is rendered once, verbatim and never truncated or summarized,
directly after the record identification and before the selected unit's
sections, under the heading `Parent user requirements — context; your assigned
scope is below.` It is context only: the selected slice remains the authority
for the assigned work and its permissions, and carrying the parent's
requirements does not establish that the slice's authored assignment is
complete. A parent with missing or empty requirements adds no section and no
refusal. An unsliced unit and direct delivery carry no such section.

Direct delivery keeps its inline guidance: the selected unit's operative notes
and tasks, its acceptance criteria, and its resolved paths. Readable paths are
the selected unit's read scope, repository paths and write scope in that order
without duplicates; writable paths are its write scope. The explicitly
selected assignment material follows in the agent brief.

In both modes the declared validation is presented as acceptance validation
outside the assignment, together with any full-suite validation named in the
authored task text, so it is not a separate worker step before commit. The
worker prompt does not refer to reviewers. Unselected parent and sibling content
stays out, exactly as the selected-unit projection already required; the managed
parent-requirements section above is the one exception. Delivery
grants no scope and no tools: R union W, the mutation targets, the
private-family exclusion, and the worker MCP tool profile are unchanged by it.

### Assignment transport diagnostics

Four stable mechanical codes describe transport integrity, not local policy.
They ride the shared refusal envelope and always precede worker spawn:

| code | meaning |
| --- | --- |
| `worker_assignment_missing` | a managed launch carried no launcher-minted assignment |
| `worker_assignment_untrusted` | the value is not the one the launcher minted |
| `worker_assignment_binding_mismatch` | the assignment binds another unit, run, monitor handle, or worktree |
| `worker_assignment_projection_invalid` | the admitted inputs could not be projected into an assignment |

### Assignment retrieval

The managed conduit authority carries the minted assignment as a private
snapshot: its non-authoritative identity (assigned unit, role, canonical source
digest, run id) and the complete guidance. Before MCP readiness the conduit
publishes it as a digest-named, owner-only, read-only artifact inside its own
private directory, through the same publisher as the frozen review contract, and
removes it in the conduit's single cleanup settlement. Exclusive creation is the
publisher's acquisition: a refused or failed create removes nothing, and any
later publication failure removes the file it created before refusing with the
originating failure as its cause and each descriptor-close or removal failure
reported beside it as `publication_cleanup_failures`. Only the host wiki-MCP
server learns its path; the confined client receives no artifact path, and
family adapters forward the minted value without adding role policy.

A worker first calls `workspace_read_wiki({assignment:true})`. Its trusted
session selects the launcher-published immutable assignment; public input names
no unit, repository, path, run, role or artifact. The first context returns a
reference; follow its complete guidance selection. The source owner reads through
a no-follow open and verifies device, inode, size, mode, digest, bound unit and
role. The frozen value is unaffected by later canonical edits and never falls
back to live canonical data. Reference selections follow the central role grants
and actual closed reader schema, not the retired member/range request grammar.

The packaged fixed probes use the same context request and execute the returned
call whose semantic selection is `select:{field:"guidance"}`, using its tool
and arguments unchanged. They consume the complete selection's `value` and
`identity`, retaining the context's `revision` as the assignment source digest
in their receipt. A missing selection, incomplete guidance or refused read fails
the child receipt; the probe does not substitute assignment text or another source.

Missing, stale, foreign or unreadable assignment material preserves the owner's
specific refusal, stage and recovery actor. No assignment content or substitute
source is returned on failure. The launcher owns artifact publication and cleanup;
result or assignment reads create no lifecycle authority.

### One terminal-result mode

Preparation resolves the terminal-result mode once, from the **provisioned
worktree** as the tier root, through the existing shared resolver. The same
resolved value governs both the prompt text and the family's native schema flag,
so they cannot diverge in source order. Where the main repository and the
provisioned worktree disagree, the worktree wins. This mode remains the
decision compliance-assist disposition and is never a launch gate.

### Controls that are not presentation

Two canonical reads remain, and neither can replace the prepared task bytes:

- Claude resolves its launcher-owned canonical write scope from canonical record
  state, as before.
- Managed Codex keeps `buildWorkerPlan` -> `resolveRemoteWorkerAdmissionProvenance`
  -> `evaluateWorkRecordWrapperGate` as the sole admissibility lane, including
  its fail-closed behavior when Node Engine provenance is unavailable. The gate
  performs every structural precondition it always did and delegates
  presentation to the prepared packet instead of composing a second one; a
  packet that does not bind this unit, role, and source digest is refused as
  malformed gate input.

Direct supported entrypoints keep their own supported acquisition and share the
same presentation owner. They are not a fallback for a managed launch that
arrived without an assignment.

## Admission refusals carry the canonical mechanical envelope

Every admission refusal on this path — subject/role matrix, readiness, the
findings-only write-scope seam, backend absence, and the authenticated CCE
limb — is built by the one public mechanical carrier and carries a registered
code, a deciding fact by identity, and exactly one continuation limb.

Graph admission is not a refusal source, and `start_agent` never builds,
repairs, updates, or waits for the code index. The worker action preview,
dispatch readiness, launch-intent validation, CCE evaluation, backend worker
admission, and worker planning all validate with live graph resolution
suppressed. Graph evidence is supplementary: readiness reports the index status
as a non-building read returns it, and consumes stored graph-impact evidence only
when it is valid for the selected unit and current snapshot. A missing or stale
graph is reported as missing or stale and left unassessed; no freshness, import
adjacency, or impact is presented for a graph that was not read. A graph-dependent
worker preview reports `assessment.graph.state: "not_assessed"`, lists
`committed_graph` as unchecked, and reports its repository commit and tree as
unknown. The explicit code-index and graph-impact routes still prepare the index
when called.

Two of those limbs are worth naming here, because they are the ones an agent
acts on:

- a NOT-DISPATCHABLE authored contract offers the canonical authoring route
  `workspace_read_wiki` for the selected unit; use its authoring selections
  and `save_record` to correct the saved assignment before starting it. A graph state never makes a unit not dispatchable, so no graph
  condition sends a coordinator to edit the work record.
- a canonical standalone reviewer or redteam unit authenticates empty effective
  mutation scope. A reviewer selecting a write-bearing implementation slice is
  delegated to the exact-target backend, which grants that action empty mutation
  authority without rewriting the implementation contract. Redteam cannot use
  that implementation-slice form. Missing, malformed, mutable, or substituted
  scope refuses before route selection; no unit identity or purpose is invented.

An absent launch backend and an authenticated CCE policy refusal both state
`no_supported_route`. That is the accurate answer rather than a missing one: no
agent-callable route registers a backend or overturns a policy decision, and
re-issuing the same dispatch against unchanged facts reproduces the same
refusal.

Normal tooling outcomes never use `operator_recovery_needed`. Validation,
launcher declaration, authority binding, backend, route, decision-envelope,
recovery-contract, scope-threshold, and portfolio failures keep a specific
registered identity, owning boundary, and every mechanically supported next
call. The operator code is break-glass only for an authenticated unexpected
condition outside the tooling model, and must preserve that exact external
condition rather than replace a known cause.

The registered identities for the launcher and monitoring families are:

| Failure family | Public identity |
| --- | --- |
| Pre-worker provisioning or the launcher could not start the child agent | `agent_launch.launch_failed_before_start.v1` |
| A registered handler raised an untyped exception | `mcp_response.handler_exception.v1` |
| A launcher composition cannot authenticate one lifecycle protocol generation | `stdio_mcp_lifecycle_protocol_incompatible` |
| The launcher could not observe a monitored subject | `agent_launch.monitor.subject_observation_unavailable.v1` |
| A run-status detail page could not be produced | `agent_launch.monitor.run_detail_unavailable.v1` |
| Recorded proof-verification evidence could not be delivered | `agent_launch.monitor.proof_verification_evidence_unavailable.v1` |
| Post-worker lifecycle recovery outran the monitor call budget | `agent_launch.post_worker_lifecycle.recovery_unresponsive.v1` |
| Post-worker lifecycle recovery ran and failed | `agent_launch.post_worker_lifecycle.recovery_failed.v1` |
| A corrective-status recovery awaits launcher retirement | `agent_launch.managed_corrective_status.launcher_retirement_incomplete.v1` |
| An authenticated CCE decision refused slice integration | `agent_launch.slice_integration.cce_policy_refused.v1` |
| A slice-integration refusal carried no recognized classification | `agent_launch.slice_integration.classification_unavailable.v1` |
| WK forge handoff could not select its destination or establish or validate the selected remote identity (executor category `remote_invalid`; the reason, such as `handoff_destination_unselected`, `remote_unreadable` or `remote_rewrite_config_unreadable`, names the case) | `agent_launch.wk_forge_handoff.remote_invalid.v1` |
| WK forge handoff refused because the WK, its candidate or its closeout was not eligible for publication (executor category `eligibility`; the reason, such as `local_WK_not_authenticated_against_candidate` or `handoff_destination_changed`, names the case and the detail keeps its diagnostic facts) | `agent_launch.wk_forge_handoff.eligibility_refused.v1` |
| A local or Git WK handoff could not observe or deliver through its selected Git transport (executor category `git_failed`; the stage and reason, such as `destination_publication_failed`, name the case) | `agent_launch.wk_forge_handoff.git_transport_failed.v1` |
| The WK forge handoff executor refused its request as invalid (executor category `request_invalid`; the issue or reason, such as `main_repo_missing`, names the case, and only a producer-established owner says who corrects it) | `agent_launch.wk_forge_handoff.request_invalid.v1` |
| WK forge handoff stopped at its CCE policy boundary (executor category `cce_policy`; the reason distinguishes malformed configuration, a missing, unavailable, malformed, mismatched or unratified decision, and an actual `cce_policy_decision_denied`; the identity carries no decision and grants no CCE authority) | `agent_launch.wk_forge_handoff.policy_boundary_refused.v1` |
| WK forge handoff observed a publication that disagrees with the authenticated candidate or captured base (executor category `publication_disagreement`; stage, reason, identities and any occurred effects are carried; no ref overwrite is authorized) | `agent_launch.wk_forge_handoff.publication_disagreement.v1` |
| WK forge handoff could not establish a publication step's outcome (executor category `indeterminate`; known `effects` and any `uncertain_effect` are carried, and an effect may have occurred) | `agent_launch.wk_forge_handoff.publication_indeterminate.v1` |
| A WK forge handoff refusal carried an undeclared category (published as category `unclassified` with the original captured; never promoted to a declared category) | `launcher_transition.backend_refusal_identity_unknown.v1` |
| Prospective or allocated launcher-transition lifecycle failure | `launcher_transition.prospective_lifecycle_unavailable.v1`, `launcher_transition.lifecycle_allocation_failed.v1` |
| A backend refusal identity is absent or undeclared | `launcher_transition.backend_refusal_identity_missing.v1`, `launcher_transition.backend_refusal_identity_unknown.v1` |

Each of these preserves the producer's own cause in `reason`, the owning
boundary, and the supported recovery. Where no callable route exists the refusal
says so rather than naming a next call, and where one does exist -- the
corrective-status and unresponsive-budget identities -- the refusal names it
instead of claiming operator recovery.

Every refusal that carries a thrown or returned failure also keeps the
complete original diagnostic evidence beside its display projection, using the
`agent_launch.diagnostic_evidence.v1` encoder: the message, stack, every own
property, the whole `cause` chain, and non-`Error` thrown values, unredacted,
with any cut-off disclosed in `capture_failures`. The public detail carries
each cause level's name, code, message and scalar facts as `cause_chain`; the
complete evidence is retained once for the operator and named by
`retained_evidence`
([Dispatch-family failure detail](mcp-operation-reference.md#dispatch-family-failure-detail)).
Nothing is masked: a structured diagnostic's original value is published
exactly in the display field, whatever its producer declared.

Node Engine and CCE admissibility belong only to implementation-worker
admission. Reviewer and redteam startup performs read-only readiness and never
requests, interprets, or refuses on worker-only declaration, binding, pack, or
decision-envelope facts. A globally registered identity such as
`authority_binding_unratified` remains valid taxonomy, but it can affect only
the worker operation that owns that condition. Frozen reviewer/redteam server
startup instead validates its committed classifier, taxonomy, constants,
discovery projection, registration surface, MCP initialize, and exact
`tools/list`; any genuine current-action startup failure retains its originating
typed identity.

typed `missing_initiative_ref_namespace` decision code. That refusal is returned
before graph recovery, CCE policy evaluation, reservation, provisioning, worktree
allocation or mutation, backend launch, and spawn; the backend is reached zero
times. It is derived solely from the canonical record — never from caller input,
prompt text, or environment — accepts only the `IN-####` shape, and is **not** CCE
policy (local renders no admissibility verdict and cannot overturn a configured
CCE decision). It is one parent-level fact that gates local dispatch. A managed
implementation-worker dispatch is also refused before any executor spawns when
the parent WK is in whole-WK `review`, with blocker code
`managed_parent_wk_review_blocks_worker_dispatch` and `actor_recovery`
`coordinator`. The coordinator route is to move the parent out of whole-WK
review or complete the terminal cycle before dispatching the slice.

A `start_agent` refused for `missing_initiative_ref_namespace` keeps that blocker
and returns one guidance call in both `next_calls` and `allowed_next_calls`: the
`workspace_read_wiki` read of the parent WK, offered only when the serving
registrar's full request contract accepts it. Which initiative the parent
belongs to is the caller's decision, so no initiative is chosen and no save is
offered. `initiative_authoring` names the correction: the caller chooses an
existing canonical `IN-####` initiative, saves `changes.initiative` on the
parent through `save_record` at the revision that read returns, and retries
`start_agent` for the same subject, where the remaining readiness conditions
are evaluated. A worker action preview reports the same cause, placement and
read. When the serving contract cannot accept the read, the blocker and
placement are unchanged, no call is offered, and
`readiness_guidance_limitation` states why.

The remaining parent-lifecycle facts — non-empty parent `acceptance.criteria` and
`acceptance.validation`, and a predeclared, singular terminal whole-WK
findings-only review unit — are **not** a free/local implementation-dispatch
admission veto. An otherwise-valid implementation unit (with a canonical
initiative and a parent outside whole-WK `review`) reaches graph recovery, CCE
policy evaluation, reservation, provisioning, worktree allocation or mutation,
backend launch, and spawn even when its parent WK lacks parent acceptance arrays,
or has no — or more than one — `terminal_whole_wk` review unit. Parent review
planning remains organizational coordination policy except for the explicit
whole-WK `review` dispatch refusal above; there is no
`parent_lifecycle_contract_incomplete` dispatch refusal.

Parent acceptance and terminal-review completeness remain an **observable
projection** that coordination or a configured CCE may consult, surfaced as a
non-authorizing fact — never as mechanical integrity or execution readiness. They
cannot set `dispatchable:false` locally, cannot prevent provisioning, reservation,
or spawn, and cannot overturn a CCE decision.

Terminal whole-WK review routing keeps its exact findings-target classification.
An eligible terminal review unit has `review_purpose` `terminal_whole_wk`, an
empty write scope, a reviewer slice dispatch intent, and a status that is neither
`done` nor `cancelled`. When exactly one exists it gives the terminal review
route one canonical identity; its absence is reported, never fabricated, and its
plurality is not an implementation-admission failure. Standalone and exact
committed-slice findings units keep their own classification, and reviewer and
redteam attempts against any of these targets remain unlimited, plural, and
advisory.

Removing the parent-planning veto does not weaken genuine pre-spawn technical
barriers: a missing or non-canonical initiative, the selected slice's own
acceptance and validation, malformed selected-unit input, invalid or non-canonical
paths, an invalid scope shape, unsupported confinement, missing
executable/backend/runtime capabilities, caller-supplied authority where
launcher-owned state is required, a conflicting
live reservation, and exact subject or repository identity failure all still
refuse before spawn.

Managed worktrees are provisioned in-process from canonical launcher roots.
Before an existing slice branch is adopted, its tip is reconciled against the
canonical WK-derived base, and containment alone is never spawn authority:
reaching an executor additionally requires that no prior managed attempt is live,
partially published, ambiguous, or unresolved. The two gates are independent and
have separate owners — see *Orphaned and ahead slice tips refuse before mutation*
and *Durable managed-run process identity* below.

The dispatch-time canonical WK-record snapshot is committed onto the WK branch
without any disposable full-repository scratch checkout. The launcher seeds a
private throwaway index from the exact launcher-bound moving WK tip
(`wk_tip_sha`), replaces exactly `wiki/work-records/<WK>.json` with the freshly
hashed canonical blob, writes an immutable tree proven to differ from that tip at
that path alone, constructs one deterministic child commit whose sole parent is
`wk_tip_sha`, and advances the WK ref by expected-old compare-and-swap against
that same tip. The fixed WK fork in `base_sha` is unchanged and remains the
terminal candidate's parent. Nothing but the moving-tip tree and that one blob
is ever staged, so unrelated main-worktree or persistent-WK bytes cannot enter
the commit. The compare-and-swap preserves whether this transaction advanced the
ref or converged
on an equivalent concurrent winner; only an owned advance is ever rolled back, an
equivalent winner is never rewound, and a within-scope no-op that finds the WK tip
already at the exact record-only child converges on it rather than stacking
another commit. After the compare-and-swap the launcher proves ref-level coherence
— WK branch ref, the persistent worktree's HEAD symbolic-ref and branch
association, the atomically rebound binding, and the returned committed tip name
one state. The persistent WK worktree stays materialized-once (decision): its
index and working files may remain at a mechanically proven cleanly-older parent,
and provisioning performs no read-tree, reset, checkout, or other file
rematerialization against it. Failure compensation runs in reverse acquisition
order and restores only transaction-owned state; persistent WK resources are never
removed merely because one attempt failed. When the failed attempt created the
persistent WK, its launcher-owned WK binding is retained with those resources:
it is the only authenticated source of the captured `base_ref`/`base_sha` that a
later attempt's adoption must recover. Compensation retains it only when that
attempt passed the complete-binding gate and the identity store's recovery
validator still resolves exactly that captured base for the WK; an unvalidated,
altered, unreadable, or conflicting binding is removed, and a reused WK's attempt
binding is removed because earlier bindings already carry its captured base.
Retained base evidence is historical identity, not attempt authority: the failed
attempt's slice binding is removed, so its launch identity forms no recovery
pair, and a later attempt adopts only through the ordinary adoption route, which
re-derives the branch, worktree association, and fork ref and still refuses
missing or conflicting captured-base evidence. Compensation does not reconstruct
evidence already lost before this rule applied.

A sibling delivery settles the parent WK record without the per-WK provisioning
lock, so the record's bytes can move while this preparation binds them. The
generation owner marks exactly that case: a `source_changed` refusal whose
`source_kind` is `canonical_wk_record_content`, with the record path and the
observing `stage` (`generation_binding`, `pre_persistence`, or
`receipt_admission`). Preparation gives that one fact one fresh attempt, inside
the same lock and before slice allocation or executor entry: it rereads the
record, revalidates selected-unit acceptance, and resolves the generation and
both bindings again. `source_changed` for an unavailable path, moved repository
identity, or changed carrier is never retried. A generation commit the first
attempt already published stays in place; the fresh attempt binds it as its
parent only when the failing owner authenticated that tip and the ref still names
it exactly, otherwise the first refusal is returned. If the refreshed state fails
another gate, that gate is returned. If the record moves again, preparation stops
after the second attempt with the owner's code, message, path, and stage, plus
`single_refresh`: the first refusal's facts and the retained WK allocation and
tips. The refusal promotes these as `failure_stage`, `source_path`, and
`preparation_refresh`, offers no call, and resubmits nothing: a later explicit
`start_agent` is a new attempt, not a promised success.

An existing correctly associated deterministic exact-slice worktree is a resume
surface, not a clean-room allocation. Provisioning preserves and admits any
mixture of staged tracked changes, unstaged tracked changes, and untracked files;
it makes no porcelain-cleanliness decision and performs no reset, clean,
checkout, restore, stash, index reconstruction, deletion, or recreation. Dirty
bytes do not weaken the independent mechanical gates: deterministic path,
full/non-sparse checkout, branch association, exact HEAD/ref relationship,
repository and binding identity, symlink/type protection, active-run reservation,
and frozen scope authority still fail closed. Changed-path containment and final
validation are enforced by the closed-input delivery/commit boundary.

## Orphaned and ahead slice tips refuse before mutation

A slice branch that already exists is a continuation base only after it is
reconciled against the canonical WK-derived base. The launcher classifies the
existing tip as absent, equal, integrated, or orphaned. Absent, equal, and
integrated tips hold nothing the WK base does not already contain, so cutting
from them can hide no delivery and allocation proceeds. A tip that is ahead of or
diverged from that base is an orphaned, unreviewed delivery: it refuses with a
stable typed reconcile diagnostic before the WK tip is adopted as anything,
before any worktree is created or reused, before an attempt binding is published,
and therefore before any spawn. A canonical base that cannot be resolved is also
a refusal — an unresolvable base is never read as "nothing to compare against".

This classification runs twice, from one authority, with no time-of-check gap.
The provisioner runs it first at the very top of the per-WK critical section,
using only launcher-derived ref/ancestry probes — no worktree add or remove, no
`git status`, and no full-index scan — so an ahead, diverged, or orphaned tip
refuses before the worktree root is created, before the WK is adopted, before the
record is committed, and before any binding is written. The slice allocator then
re-runs the identical gate at use, so the early check is a fast-fail optimization
and is never sole authority.

The refusal reports Git facts only. It never infers that the prior worker
finished, never deletes or moves a ref, and never offers the unreviewed tip as a
continuation base: the recorded delivery stays exactly where the worker left it
and is addressable through the exact-slice review recovery route. Containment is
decided by the ancestry oracle alone; any Git failure while deciding it fails
closed rather than being read as either contained or orphaned.

Publicly the retained-delivery case is its own blocker,
`managed_slice_tip_reconcile_required`: provisioning is available, recovery is
coordinator-owned, and the route is exact-slice review through the monitor
surface — not the provisioning capability preflight. The refusal carries the
bounded reconciliation facts (state, slice tip, canonical base ref and sha,
recovery route, responsible actor, next action) at the top level of its detail,
so no caller has to read a nested source diagnostic to learn what to do, while
the substrate's own typed diagnostic is preserved underneath unchanged. The
blocker is narrow by construction: it is selected from the trusted substrate
diagnostic alone, never from caller input, and every other condition keeps its
existing code. An unresolvable canonical WK base remains an operator
reconciliation problem rather than a review-recovery condition.

The fresh-WK selected-base path has a still narrower public diagnosis. The
canonical record-level `base_branch` is the only selector the launcher
allocates from. One selection rule serves preview and `start_agent`: a saved
root `base_branch` always wins; when it is absent on an unallocated WK, the
current symbolic local branch of the configured repository checkout is the
default. The rule never reads the process working directory and never names
`main` or `master` itself. Actual `start_agent` saves a defaulted branch into
the root's `base_branch` through the revision-checked `save_record` owner
after the launcher's pre-allocation missing-selection refusal, then runs the
complete dispatch once more so the existing allocation captures the commit; the
result carries `base_selection` with `saved: true`. If that save does not land,
dispatch stops before allocation and child start with
`managed_worktree_base_selection_save_failed`, the save's own outcome under
`base_selection_save`, and the root read below; nothing is retried. If the save
lands and the rerun then refuses or fails, the saved choice stays and the
rerun's actual result is returned with the same `base_selection`. With a
detached `HEAD` there is no default, and dispatch refuses before worker start
and directs the
coordinator to author `changes.base_branch` through root `save_record` with the
current root revision and the operator's explicit branch choice. If it is
present and the required-base resolver's typed operation reports that real Git
failed to resolve `refs/heads/<base_branch>^{commit}`, and the trusted
provisioner proves that exact local branch is absent, dispatch reports
`agent_launch.launch_failed_before_start.v1` at the
`pre_worker_worktree_provisioning` / `base_ref_resolution` stage. The result
preserves the substrate's `agent_launch.worktree_substrate.git_failed.v1`, Git
exit and stderr when Git ran, the required selected ref (or null for a missing
selection), the actual repository path selected by the provisioner, the
requested repository alias when present, and `work_record.base_branch`
selection provenance. Authored readiness is unchanged: no worker, tests, or
proof execution began.

A missing base selection with no default refuses before launching. Its returned
`workspace_read_wiki({subject})` call reads the owning WK and its authoring
context through the actual serving schema. The operator chooses the base
branch; `save_record` writes that explicit choice against the current revision.
Then a new `start_agent` call reassesses the saved source in full. Reading the
context does not select a branch or clear the blocker.

If the root was selected concurrently, the route never overwrites it. When the
refusal proves a worker-role, pre-start, compensated, unallocated failure with
null public handles, the complete dispatch runs once more with fresh readiness,
plan and run/monitor/retry identities, and the response carries
`base_selection_reassessment`. A second concurrent move returns
`no_supported_route`; there is no further retry.

A missing selected ref has no automatic recovery route. Before allocation, the
operator must make the selected local branch resolve to the intended commit, or
correct `base_branch`, then retry dispatch. Retry alone does not create, rename, or
repair a ref. A saved selection is never replaced: the launcher does not fall
back to `main`, `master`, the checkout branch, current `HEAD`, or branch
inventory for it and never creates an alias. A failed exact-branch probe,
repository corruption, and unrelated Git,
configuration, allocation, or worktree failures keep the existing
`managed_worktree_provisioning_unavailable` path rather than being called a
missing base ref.

Optional the internal dispatch-readiness owner applies the same selection rule
prospectively, so validation names the branch that will be targeted: a passed
or refused `worker_scope_preflight` on an unallocated WK reports `base.ref`,
`base.selection` and `base.publication_target`. With no saved `base_branch` and
a detached `HEAD` it reports the missing selection: its `worker_scope_preflight` is
`not_evaluated` with `reason.code: scope_existence_base_selection_missing`, and
`reason.message` names the root WK, the record-level `base_branch` field, the
ordinary editor and its root field guidance, the fresh root-record CAS, and the
launch refusal the missing selection produces. When no higher-priority refusal,
recovery or canonical `next_calls` applies, a readiness that would otherwise
dispatch reports `dispatchable: false` with
`decision_code: "scope_existence_base_selection_missing"`, keeps the prior
structural result under `structural_readiness`, and the free/local and paid
presentations both project that message as `next_action`. The report itself
stays `not_evaluated`. The preflight writes nothing, is not a required call or a
launch token, and the launcher remains the refusal owner. The worker action
preview of `start_agent` composes this same preflight, so the selection, or its
absence, is visible before a launch is attempted; actual start keeps its own refusal.

The first allocation resolves the selected branch once, captures its commit,
and creates the WK worktree from that captured SHA rather than re-reading the
moving branch. The identity binding and launcher-owned fixed-fork ref preserve
the pair. Adoption and retry recover that authenticated pair from existing
bindings; a later record value that disagrees refuses instead of rebasing, and
a later switch of the configured checkout's branch changes neither, because
only an unallocated WK is ever selected from the checkout.
Every slice still starts from the authenticated current WK tip. Forge handoff
targets the same captured per-WK base branch, not the repository default.

This gate decides **Git topology only**. Whether a prior managed attempt may be
replaced by a new worker is a process-identity question with a single authority —
see below.

### Declared unit dependencies are authenticated conjunctively

A declared `depends_on` population is selected by wiki-core's canonical
dependency-evidence owner. A selected slice uses exactly its own explicit
population; the parent record is not combined or inherited, and an explicit
empty list means no dependencies. Unsliced work uses the record population.
The orchestrator assigns every applicable prerequisite to the executable slice.
For local targets, literal identity, lifecycle status, initiative, provenance,
and `target_work_kind` come from server-read canonical WK JSON. Caller-supplied
status, work kind, initiative, identity, provenance, marker, or reason remains
observable analysis only and never replaces or suppresses a canonical fact.
Missing or vocabulary-unknown canonical `target_work_kind`, malformed addresses,
and missing canonical targets retain wiki-core's `fact_resolution_failed`
mechanical evidence and failure code; the launcher neither defaults nor reparses
them.

Lifecycle status is not dependency admission authority. No local done-only,
blocked-status, review-status, or other lifecycle predicate refuses dispatch.
Under decision an unmet edge is either a wiki-core mechanical fact-resolution
failure, a launcher-owned mechanical Git-integrity failure described below, or a
separately authenticated returned policy decision. A condition that names none of
those limbs does not refuse. The slice-DAG done frontier remains a coordination
projection only and feeds no readiness or provisioning decision. This read-only,
pre-provisioning resolution is decision clause 2 free substrate.

The dispatched subject must still resolve as the exact canonical implementation
slice. For dependencies, only canonical `target_work_kind: implementation`
enters the Git-integrity path. Canonical review and redteam dependencies require
no delivery ref and no initiative-derived Git identity; their lifecycle status
is carried as evidence but never consulted. The same no-ref rule applies to
other canonical non-implementation dependency kinds. A self-edge remains a
mechanical identity failure. Repo-qualified external edges preserve their
existing mechanical disposition without deriving a cross-repository ref or
introducing cross-repository policy.

**A same-WK implementation slice dependency is answered only by the shared
integrated-delivery observation.** The launcher captures the subject WK tip and
the dependency's retained slice tip with exact `show-ref` queries, without
peeling, and requires canonical non-zero object ids. It then awaits one
launcher-captured-tip observation from `observeIntegratedSliceDelivery`
([slice integration](mcp-dispatch-slice-integration.md#captured-tip-dependency-observation))
before consuming its answer. No ancestry probe runs before it or as a fallback.
The observation returns one of three facts:

- `present` — the exact retained delivery is authenticated as integrated into
  the captured tip. The dependency is met whatever the record's reported
  `record_reconciliation` substate (`reconciled`, `pending` or `blocked`);
  observation enacts no ordering policy and dispatch writes no record.
- `absent` — a completed permitted observation proves the exact delivery is not
  in the captured tip. The dependency is unmet with
  `dependency_not_present_on_wk_branch` and evidence `integrated_delivery_absent`.
- `indeterminate` — a named required fact was unavailable, malformed, mismatched
  or moved. The exact-resolution failure is the distinct
  `dependency_observation_indeterminate` (class `dependency_observation`), never
  `unit_dependencies_unmet`.

A dependency diagnostic names the dependency, the WK and dependency refs, the
captured WK tip, the retained delivery, the observation state and reason, and,
for a failed read, the distilled cause: the failed operation and object or ref,
exit status, signal, spawn error, timeout or output-overflow flags and at most
the first stderr line. Raw Git output never crosses. An unmarked commit that is
merely an ancestor of the WK tip is not an integrated delivery; no markerless
compatibility exists.

**Every other implementation dependency keeps exact literal ancestry.** A cross-WK
slice or whole-WK implementation dependency is present only when its retained
tip is a literal ancestor of the captured subject WK tip. Every authority-bearing
Git argv begins with `--no-replace-objects`. The launcher reads each full oid's
literal commit with `cat-file`, parses its complete literal parent list, and
performs a bounded walk of those literal parent oids. Replacement refs, revision
expressions, and semantic history output are not ancestry authority; graft
inputs are irrelevant because Git's semantic parent view is never consulted.
Malformed objects, missing parents, cycles, bound exhaustion, inconsistent
output, and Git faults are indeterminate refusals (`ancestry_indeterminate`)
naming the offending `object` and a `detail` that separates Git read outcomes
(`literal_commit_read_failed`, `literal_object_not_commit`) from parsing
(`literal_commit_malformed`, with a stable `parse_reason`). A determinate
non-ancestor is `not_ancestor`. A marker naming another record grants nothing
however reachable it is.

One shared launcher parser reads every literal commit. It validates every
structural header and continuation before using the tree or parents; a CR, NUL,
other control byte, or malformed line in the header section makes the object
unreadable and grants no authority. The message is everything after the first
blank line and is returned verbatim: CR, CRLF, NUL, and other bytes are ordinary
message content, are never normalized, and cannot make an ancestor unreadable.
Because the Git runner delivers text as UTF-8, a header or message containing
U+FFFD cannot be proven byte-exact and is refused as malformed
(`message_bytes_unrepresentable` or `header_bytes_unrepresentable`) rather than
substituted. Marker and delivery message comparisons remain exact byte equality,
so a CRLF rendering of a server-generated message is not that message.

All implementation Git evidence is bound to the allocated or adopted subject WK
tip and every exact implementation dependency ref/tip used by either proof.
Review, redteam, and other non-implementation dependencies create no dependency
ref to bind. work record first performs its existing allocation/adoption settlement.
The launcher then freezes the settlement's slice base and requires its ref and
SHA to equal the settlement's persistent-WK ref and tip exactly. Only after that
equality proof does dependency assessment begin. After the last dependency probe,
the launcher re-resolves every captured ref and requires byte-identical equality.
Movement, rewind, deletion, malformed output, or an indeterminate read refuses
before policy continuation, reservation, conduit construction, and process spawn.

The gate's non-authorities are as narrow as its evidence. It performs no retry,
sleep, current-main synchronization, WK-ref repair, cleanup, fallback
reconstruction, or canonical status mutation; it accepts no caller-carried
dependency evidence, prompt text, or environment; it renders no review verdict and
changes no CCE policy boundary; and it grants no existing-slice continuation
authority — the exact-slice reconcile gate above remains independently
load-bearing. A refusal is a coordinator-owned re-dispatch, not a repair.

## Unified launcher transition plan

`launcher-transition-plan.v1` is the one finite readiness-to-spawn projection.
Its exact top-level fields are `schema_version`, `identity`, `phase`,
`role_runtime`, `lifecycle`, `dependency`, `publication`, `cce`, `reservation`,
`spawn`, and `failure`. The launcher composer is pure: it allocates no lifecycle,
mutates no ref or record, evaluates no policy, observes no publication, reserves
no subject, and spawns no process. Registered readiness creates the prospective
plan; `createLaunchFlow` revalidates that exact identity and the work record selection,
then forwards the allocated projection unchanged through the family executor.
Coordination preflight may carry the exact frozen plan by reference only.

The only permitted readiness/accepted-dispatch differences are `phase`
(`prospective` to `allocated`) and freshness authenticated during launch. Every
other identity field must remain equal. Callers cannot supply a plan or identity.
No second transition schema or wrapper-owned semantic envelope is supported.

### Response object placement

The launcher transition plan and managed allocation are internal authority. No
dispatch response publishes either. An accepted dispatch returns the compact
receipt described in [Runtime contract › Accepted dispatch
receipt](mcp-dispatch-runtime-contract.md#accepted-dispatch-receipt). A refused
dispatch publishes its blocker and refusal, the plan's failure descriptor as
`transition_failure`, and a compact `readiness` whose `cce` carries the exact
policy decision and recovery the plan bound; see [Runtime contract › Refused
dispatch response](mcp-dispatch-runtime-contract.md#refused-dispatch-response).

Internally the plan keeps its authority. The launch input carries the
prospective plan both as `launcher_transition_plan` and on its readiness. Before
any response is built, the accepted plan must revalidate as the allocated
continuation of that prospective identity, and a managed allocation must
project through `projectLauncherTransitionReadiness` as the exact frozen
allocation; a refused allocated attempt's settled and active plans are checked
the same way. Each divergence keeps its
`launcher_transition.lifecycle_allocation_failed.v1` refusal.

work record composes retained owners; it does not replace them:

- work record owns role, target, model, application, and runtime selection.
- work record owns allocation/adoption settlement, retry, compensation, CAS-loss,
  concurrency, refs, and worktrees.
- work record owns corrective-history receipt authentication.
- work record owns findings-route classification and authenticated confinement/MCP
  transport.
- The landed-publication owner alone produces `forge-confirmed-landed-publication-identity.v1`
  and `git-landed-publication-identity.v1`.
- CCE alone returns policy decisions and recovery.

A completed cross-WK implementation dependency is admitted only with the exact
frozen carrier returned by the read-only landing observer: hosted forge-confirmed
or local/Git base-history landing. That observer never publishes, merges,
reconstructs or materializes a candidate, or reconciles the canonical record, and
an observation that is not `landed` admits nothing. Status, closure prose,
messages, stale WK refs, and reconstructed publication fields grant nothing.
Manual ref repair and publication replay are not recovery actions.

### Ownership of transition semantics and the managed-provisioning carrier proof

Two semantics that the launch path depends on have exactly one owner each, in
`@agent-chassis/agent-launch-core`. decision places the shared launch dispatch
substrate there, and core never imports `agent-launch-cli`.

| Semantic | Sole owner | Compatibility and host boundaries |
| --- | --- | --- |
| Launcher-transition plan, closed failure taxonomy, and authenticated backend-refusal classification | `agent-launch-core/src/lib/launcher-transition-plan.mjs` | `agent-launch-cli/src/lib/launcher-transition-plan.mjs` is a thin re-export that owns no classification, cause or recovery precedence, redaction policy, or transition semantics. |
| Managed-provisioning carrier meaning — exact v1/v2 field sets, subject and current-attempt identity, path containment, nested-binding completeness, mirror invariants, independent WK-versus-slice resources, restored-carrier deep freeze | `agent-launch-core/src/lib/managed-provisioning-result-shape.mjs`, published through `managed-provisioning-result-assertion.mjs` | `agent-launch-cli/src/lib/worktree-provisioning-dispatch-binding.mjs` re-exports the confined structural assertion by identity and adds only host-physical evidence. |

`packages/wiki-mcp/src/lib/dispatch-tools/register.mjs` is a **structural public
projector** over the core classification. It classifies each authenticated
backend refusal once and then projects; it performs no classification, reason
matching, authority matching, truncation, fallback substitution, or recovery
selection of its own.

The two managed-provisioning proofs remain non-substitutable. Both run the same
core-owned structural rules; they differ only in what the caller supplies:

- The **confined structural proof** — the read-only orchestrator wiki-MCP
  namespace — runs with the launcher-owned worktree root deliberately unmounted.
  It performs no stat, realpath, Git, or worktree-root access, proving containment
  by pure path math, and it additionally requires the restored carrier to be
  deeply frozen. A carrier crossed a JSON wire, so its immutability is evidence
  that the adapter re-froze it, not a formality; a mutable, reconstructed, or
  changed or reconstructed carrier is rejected.
- The **host-physical proof** — the writable host boundary — injects realpath and
  stat canonicalization plus the Git HEAD/ref and fork-ancestry evidence around
  the identical structural rules. It accepts a mutable host carrier because it
  runs before `freezeManagedResult` seals it.

Accepted carriers return by identity in both proofs, so a caller can prove the
admitted object is the exact one it submitted. Refusals carry one stable code,
message, and structured detail, and select no launcher recovery: recovery, actor,
and next-action selection belong to the launcher-transition owner.

The exact refusal classification, producer envelopes, refusal response field
list, and redaction signal vocabulary are specified in
[MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md#authenticated-backend-refusal-classification).

### Scope-selected lifecycle settlement and public readiness

Lifecycle selection follows the launcher-authenticated effective `write_scope`,
not role. Empty-write-scope actions bind a detached immutable findings snapshot
containing the exact record and complete selected contract generation, then
create one independently bound advisory action without allocating, reading, or
changing a persistent WK ref. Nonempty-write-scope implementation admission
alone invokes work record allocation/adoption, generation persistence, canonical-WK
snapshotting, worktree reconciliation, and exact-slice authority. Role policy
continues to own confinement and transport; it does not select lifecycle.

work record's readiness-shape module is the sole constructor of the bounded
`managed-wk-allocation-readiness.v1` envelope. The public readiness/start-launch
route transports the same scope-selected result; it does not rebuild the result
or expose worktree paths, manifest member bytes, or another continuation. For
findings readiness an absent persistent ref stays absent and an existing ref is
not consulted. Implementation readiness still allocates or adopts an absent ref.

Allocation CAS loss and controlled-generation persistence CAS loss admit only
an exact equivalent winner. Restart after allocation, generation persistence,
or WK snapshot re-observes the exact durable effect. Authenticated WK-tip
movement invalidates every tip-bound transition projection; only a fresh
work record owner carrier can settle the new tip. Partial ref or worktree
observation converges to the same identity or refuses without another write,
identity substitution, confinement widening, cleanup, raw repair, or duplicate
spawn. Manual ref creation, direct persistence,
`establish_persistent_wk_lifecycle_ref`, a second allocator or persistence
owner, new locks or retry loops, registries, and recovery tools are outside this
route. work record's already-owned serialization and settlement behavior is
unchanged.

Worker spawn uniqueness remains keyed by the canonical implementation-subject
reservation. Findings have no uniqueness election: every accepted empty-scope
dispatch mints a fresh run and monitor, registers both process-locally, and makes
one confined advisory launch. A prior findings action, receipt, result, failure,
or process identity cannot select, resume, suppress, replace, or veto it. Source
identity remains an authenticated immutable Git commit/tree selection, and every
action independently verifies its complete controlled generation and execution
substrate. CCE and decision confinement keep their existing authority boundaries.
Every refusal remains typed and fail-loud.

decision keeps explicit standalone technical redteam distinct from CCE reviewer
mode. Its work record admission must authenticate the exact canonical unit and launch
subject. Missing or mismatched admission is a mechanical refusal before technical
role authority, lifecycle allocation, conduit construction, or spawn.

### Proof-authoring readiness in a dispatch decision

The controlled-acceptance state projection publishes `definition_readiness`
beside the shared semantic subset. The subset keeps the readiness decision and
its exact counts; `definition_readiness` is the first-response presentation of
the same owner facts.

It names how many authored obligation definitions are complete, which obligations remain
unresolved (`unresolved_obligations`, with their count), and for each one the
authored inputs it lacks (`authored_input_diagnostic_codes`, the authored-input
stage's own codes, which never include an execution prerequisite). It also names
the affected obligations behind the terminal-gap total and the one supported
correction: the existing coverage query followed by
`..._obligation_coverage_upsert`, answered with caller-authored data. Inline
lists are capped and report what they omitted; counts stay exact.

Both members derive their terminal gaps through the same classifier over the
same workbench, in separate calls. When the private ready-slice authoring owner
refuses a slice because the parent's controlled acceptance does not admit it,
and the two detailed `groups` populations are identical, the refusal's
`controlled_acceptance_state` publishes them once, at
`controlled_acceptance_state.semantic.terminal_gaps.groups`. Its
`definition_readiness.terminal_gaps` keeps every count, the affected
obligations and `groups_omitted`, and states `groups_published_at` (that
location) and `groups_returned` instead of repeating the groups. Groups that
differ are separate facts and both stay. The semantic subset, its admission
decision and the correction are unchanged.

The compact the internal dispatch-readiness owner response carries that projection on
`controlled_acceptance_state`. A required contract's whole readiness rarely fits
the compact complete-frame class, and the byte budget is unchanged, so when the
controlled-acceptance member cannot be inlined the selected summary publishes
the same owner facts in bounded form under `selected_detail.definition_readiness`:
the complete and incomplete definition counts, the open obligations and their
missing-input codes, the execution facts, and the correction. The open
obligations report their exact total with an explicit omitted count. Their
identities are listed before their codes, so the summary also reports
`explanations_listed` and `content_complete` separately: every row named is not
every explanation carried. Whenever an identity or explanation is omitted, the
summary offers a recommended source-bound detail call that reads the owner's
whole projection losslessly, even when an earlier member is the first omitted
one. Nothing in the summary is recomputed or reclassified.

The bounded correction states `selected_unit_source`: `absent` when the selected
unit has no saved coverage source, `present` when a populated source is still
incomplete. The two causes take the same correction; only the source's presence
is carried, never the owner's observed digest. While the owner's executable
`next_calls` are inline, the detail call for the first omitted member is offered
with `recommended:false`: reading it would restate a correction the caller can
already execute, so it stays optional lossless detail. Detail calls for reasons,
owner calls or definition facts the summary could not list remain recommended.

The correction's `expected_content_digest` comes from the response of the
coverage query the correction itself names
(`expected_content_digest_from: read_tool_response.content_digest`). A digest
observed anywhere else -- including the `record_source_digest` the same readiness
publishes -- belongs to a different domain, and the coverage owner refuses it.

A proof definition is derived from the authored case, selector, claim and
obligation relationship. Execution evidence is separate: it is produced by
`verify_proof` against declared tests that implementation has yet to
write. `definition_readiness.execution` therefore reports
`required_before_authoring:false` and `creates_definitions:false`. A complete
definition population whose execution has not started satisfies this authoring
prerequisite; no verification call creates a missing declaration, and a
not-started execution is never the reason this stage is open. Every other launch
prerequisite still applies, and a genuinely absent or unresolved definition
remains mechanical incompleteness.

Incomplete authored inputs report `controlled_acceptance_authored_inputs_incomplete`
rather than the aggregate `obligation_coverage_resolution_required`, which
describes a different cause.

The shared semantic subset also carries the deciding semantic cause summary:
exact cause and affected-obligation totals, bounded groups and identities, and a
source-bound `workspace_assess_contract` detail call. Diagnostic provenance names
the incumbent owner that observed a fact; it is not repair authority. Repair
authority exists only for an authenticated semantic transition. Missing fields,
competing values, and identities omitted from a bounded preview remain available
through validation's existing paginated diagnostic-group collection and selector.
All six consumers read these same facts rather than reconstructing a local cause.
The deciding cause is selected from owner facts: `admission.deciding_causes`
lists the readiness owner's open conditions. When uncovered acceptance criteria
alone decide the refusal, the owner, codes, counts, explanation and next call
come from the criterion-coverage owner, and the workbench observations move to
`admission.independent_observations`. the internal dispatch-readiness owner carries the
same `deciding_causes` on `controlled_acceptance_recovery` and uses the coverage
explanation as its reason. Blocked `start_agent` prefixes the same
denominator and uncovered identities to its next action. See
[Acceptance coverage](acceptance-coverage-mcp.md).

The private ready-slice authoring owner consumes `admission.recovery_capability`.
It reports `actor_recovery: agent` only for an available authored correction (or
a source refresh), distinguishes an inspection call from that correction, and
reports classifier or owner exceptions as `system_owner_failure` with no agent
repair claim. A refusal before the core mutation begins always reports
`contract_persisted:false`, `written:false`, and `no_op:true`, while preserving
the original exception code and details.

### The selected unit owns its proof obligations

Proof obligations and their proof selections belong to the unit of work. For
sliced implementation work that unit is the slice, so every controlled-acceptance
surface -- canonical classification, read-only workbench inspection, ready-slice
shaping, the internal dispatch-readiness owner, launcher preflight and managed
provisioning -- classifies the exact selected unit it is about to act on and
passes its own already-authenticated selection to the one classifier. The
projection and its shared semantic subset name that unit in `selected_unit`
(`kind`, `address`, `record_id`, `slice_id`), the evaluated snapshot's source and
the assessment source carry the same selection, and the workbench reports
subject, assessment-source and coverage-owner agreement on it as one
`cross_owner_consistency` identity.

A blocked `start_agent` implementation request publishes selected-unit
`workspace_read_wiki` guidance only when the serving registrar's full request
contract accepts it. The read preserves the exact slice, cause and uncovered
criterion identities and leaves the blocker unchanged. The readiness owner's
explanation names current `save_record` authoring with the read context's fresh
revision and caller-authored `changes.obligations` and criterion associations.
This is a template requiring verification meaning, not a complete executable
save or proof mapping inferred by the launcher. Internal assessment carriers
retain their owner facts; those facts do not establish launch admission.

A complete-but-stale population retains
`controlled_acceptance_source_not_current` and the canonical
`source_refresh_required` recovery across the internal dispatch-readiness owner, managed
preflight, and managed provisioning. The launcher diagnostic remains distinct
as
`agent_launch.worktree_provisioning_dispatch.controlled_acceptance_source_not_current.v1`;
neither launcher surface relabels currentness as ordinary incompleteness or
offers proof upsert as the refresh.

A parent's or a sibling's population is therefore a different unit's fact and can
never complete a selected slice. A slice with no saved coverage source reports
`obligation_coverage_source_not_found`, an empty population and
`controlled_acceptance_incomplete`, and its recovery -- the coverage query and
its `..._obligation_coverage_upsert` follow-up -- addresses `work record`
rather than `work record`. This is the same exact unit `verify_proof`
already requires when it resolves the saved source it will execute, so a
dispatch decision and the verifier can no longer disagree about which population
exists.

Shared definitions are unaffected. Case definitions keep their single canonical
owner on the parent source, a slice reuses one by reference rather than copying
it, and a slice source that carries case definitions is refused. Execution
ownership still follows the declaring unit: shared case visibility grants no
authority, and a slice that declares no executable target cannot complete a case
that needs one. Nothing here copies parent obligations into a slice or gives a
slice a parent fallback.

Inspection-only and executable-map observations remain available with their
original provenance and detail calls, but their recovery status is scoped to
the observer that produced it. `inspection_only` on such an observation does
not override an admission-provided agent correction. Conversely, a genuine
classifier or semantic-owner failure remains `system_owner_failure`, and stale
source recovery remains source refresh rather than proof authoring.

Two things remain scoped to the record rather than to a slice. The
controlled-acceptance disposition on `proof_posture` is a record-level fact, and
whole-contract settlement recomputation stays a whole-contract operation.
The private ready-slice authoring owner keeps one deliberate exception: a request
that omits `slice_id` ALLOCATES the next ordinal slice, and that unit does not
exist yet. Requiring its own coverage there would be a circular requirement that
an unallocated slice already have a source, leaving it permanently unauthorable,
so an allocating request asks about the record -- the only unit it has -- and the
slice's own coverage is assessed from the call that selects it with `slice_id`. A
`slice_id` naming no existing slice stays the core operation's
`ready_slice_unknown_slice` refusal, not a coverage question.

### The question the internal dispatch-readiness owner answers

the internal dispatch-readiness owner answers exactly one question, and its contract
names it: **is the saved unit, and the saved contract it names, internally
coherent and complete as a document?** That verdict is decided from the
canonical work record or slice, its authenticated proof posture, and the saved
controlled-contract carriers that posture names. It is reproducible from those
bytes alone.

**Can the current world satisfy what the document says?** is a different
question with a different owner. `verify_proof` answers it at verify
time against the installed registry, catalog and runners, and reports an
incapacity through its own enumerated causes. It is not an input to dispatch
readiness. A unit whose selected proofs nothing can execute today is a complete,
well-formed unit, authors normally, and dispatches normally.

The route enforces that boundary rather than trusting it. A proof posture may
block dispatch only on `controlled_acceptance_disposition_missing`,
`controlled_acceptance_incomplete` (staged `authored_inputs` or
`canonical_sources`), or `controlled_acceptance_source_not_current`, and only
with no unavailable system operations attached. An admission verdict that
carries any other ground -- a `system_capability` stage, an unavailable
operation, a capability reason code -- is a fulfillment fact that reached a
well-formedness boundary. It is refused there as
`dispatch_readiness_fulfillment_fact_refused`, naming the offending fields and
`verify_proof` as the owner that does answer it, instead of being
reported as this route's structural answer. The complete or opted-out proof
posture precondition is unchanged: it asks whether the posture is filled in or
its elements explicitly opted out, which is a property of the document.
## Findings-only advisory review

Empty effective mutation scope is the sole findings lifecycle discriminator.
Canonical slice, terminal whole-WK, and explicit `{ diff_base_sha, reviewed_sha }`
selectors all call the same normalization and immutable snapshot owner. A
complete SHA pair is an ordinary review input: it locates bytes but is not an
authority carrier, attestation, receipt, or provenance record. The resolver
validates only commit identity, ancestry, the required nonempty range, readable
tree, and exact private-snapshot bytes. A bad pair refuses only its current call
and creates no persistent recovery or WK state.

The request still uses a canonical WK or `work record` coordination
`subject`; the SHA pair is additional locator data on that same
`start_agent` call. For example:

```json
{
  "role": "reviewer",
  "subject": "work record",
  "diff_base_sha": "<40-character base commit>",
  "reviewed_sha": "<40-character reviewed commit>"
}
```

A bare SHA in `subject` remains a mechanical refusal. Its bounded correction
offers exactly one callable recovery:
the registered `start_agent` declaration in `tools/list`.
That registered description carries the concrete canonical-subject-plus-SHA-pair
shape above. The caller supplies its already-known WK or slice; the server never
infers or searches for one from a SHA. The same registered dispatcher performs
the corrected review. No external reviewer, shell command, wrapper, alternate
transport, terminal candidate, ref creation, attestation append, or provenance
repair is required.

In an operator-authorized direct-to-main lifecycle, commit the exact scoped
implementation candidate first and dispatch its read-only review with the
canonical subject plus the landed commit's complete base/reviewed SHA pair.
Terminal-candidate status, advance, and forge handoff do not participate, and the
reviewer never creates Git objects.

Capture is one normalized-target transaction. Selector form is erased before
execution and cannot choose another lifecycle, route, retry, result contract, or
provenance requirement. Nonempty implementation admission continues to use the
existing persistent WK allocation, generation persistence, confinement, and
compare-and-swap path unchanged.

Reviewer and redteam prompts are text-first and name the package-owned
reviewer guide in one `Read your reviewer guide before acting: <path>` line;
the launcher grants that exact file read-only. Their startup text keeps only the
role, subject, reviewed
range, tree, and descriptor identity and the result-format instructions; it
does not serialize the assignment. It directs the reviewer first to read the
assigned unit's root through `workspace_read_wiki` from its existing review
source and, for a slice, the parent record's root, since a slice root does not
carry its parent contract, and to follow the returned member calls and selected
material references. Review source selection and broader context reads are
unchanged on every route. They ask for the actual advisory
analysis and state that it remains usable whether or not optional structured
metadata conforms. Worker-only outcomes are not offered. Schema-constrained
output is reserved for an explicitly selected formal-attestation use; ordinary
review prompts never imply that JSON adherence determines review acceptance,
occurrence, usability, or lifecycle posture.

Backend routing resolves the authoritative source exactly once and mints one
launcher-private immutable source-selection carrier. Provisioning authenticates
that carrier and materializes only its exact bytes. The findings context carries
the carrier opaquely together with frozen acceptance, readiness, and graph-impact
facts; it never reconstructs source authority or lifecycle state. Technical
reviewer/redteam identity is applied only afterward for prompt/persona, confined
tools, result schema, and completion transport. Family planning must not run a
second readiness pass against the sparse snapshot or accept graph-impact evidence
from argv, prompt, ambient environment, or caller fields.

Every reviewer/redteam dispatch adds one narrow projection to that transaction,
whatever its selector: canonical design, exact implementation SHA range,
implementation slice, or terminal candidate. Routing captures the current WK file
that carries the assignment, its selected entry material, and only the canonical
controlled-contract/proof members selected for that WK, verifies that none moved
while capture was in progress, and writes those exact bytes at their canonical
paths in the fresh detached review checkout. The rest of the checkout remains the
selected Git commit, so implementation bytes stay at the reviewed commit and
unrelated tracked dirt and untracked host files never enter the action. The
captured WK may be newer than the one committed at the reviewed commit, so an
assignment authored after that commit is still readable; dispatch never amends a
commit or moves a candidate ref. The capture is action-local: host edits after
capture do not alter the active review, and the next independent dispatch
captures the new canonical bytes.

The capture is also the review's complete source for the selected WK, and the
launcher binds it. Beside the WK file, its entry material and its selected
contract, capture takes the other authored sources an assessment of that WK
reads, each as it is at dispatch: the optional scope record; the internal
acceptance-axis carrier of each unit and published focus, as bytes, when one is
present; and the contract files of the WK's `related` work records that the
saved-proof owner actually reads as mapping contracts. That owner decides the
last by running, for each unit at the root focus and at each focus the selected
contract publishes, over the repository through a recording source observation, so
a related record no assessment reaches, and any other focus of one it does
reach, is neither inspected nor captured and cannot refuse a capture. A source
that is absent is not captured. Capture refuses only when the owner fails after
opening a related record it uses.
Absence at capture is part of what is reviewed. The private checkout starts as
the reviewed commit, so materialization removes from that newly created checkout
only: each controlled-contract source that the contract layout owner classifies
as the selected WK's and capture did not take; each consumed input capture found
absent, at its exact path (the optional scope record, an acceptance-axis
carrier, a related file the saved-proof owner asked for); and, of each related
record that owner read, the contract sources the store did not hold at capture.
Every other WK's files, unselected archived generations, code and documents
keep the reviewed commit's bytes, and nothing in the live repository is touched.
What capture found absent is launcher-internal bookkeeping of that one
materialization; it is not handed to the session. Capture authenticates
material, not readiness: incomplete, draft and association-invalid contracts are
captured as authored, and a WK with no contract is reviewable as its record
alone.

The run's advisory review source binding commits to five closed facts: the role,
assigned unit, run, canonical repository and materialization root. The bound
private checkout is the review source, and the conduit hands its server that
root and the session contract; there is no separate source descriptor. The
host's single findings-source resolver authenticates the session on every
request: the presented contract against the launcher-expected one, the role and
assigned unit, exactly one source binding for the run, and a digest recomputed
from this host's own five facts. Its refusals name the deciding condition and
its subject: `findings_source_role_unsupported`,
`launcher_session_unauthenticated`,
`advisory_review_source_binding_absent`,
`advisory_review_source_binding_duplicated`,
`advisory_review_source_binding_mismatch`,
`advisory_review_repository_unavailable`,
`review_materialization_unavailable` or `review_materialization_unreadable`.
The resolver repairs nothing, reads no other source and offers no retry: a fresh
source exists only when a coordinator dispatches a new review. Readers then take
the checkout's files through their own native read paths. The binding isolates a
review from live `main` and from every other run; it does not detect edits made
inside the private checkout after launch.

The shared launcher role-contract renderer directs every Codex and Claude
reviewer/redteam client to the assigned unit's canonical
`wiki/work-records/WK-####.json` inside that already-bound snapshot and names the
exact selected unit address. That snapshot-local unit's acceptance criteria and
validation are the findings acceptance source. Live `main`, inline mutable
current-record bytes, and the operator diagnostic frozen-contract query are not
source-selection alternatives. The diagnostic query is neither findings
acceptance transport nor a launch prerequisite.

For an exact implementation-slice review, routing authenticates the current
record and selected-unit identity before it attempts Git target resolution. The
bounded current-record refusals remain distinct through the backend and public
projection: absent record, incomplete or mismatched identity, invalid `slices`,
absent selected slice, wrong selected `work_kind`, and other malformed selected
slice material do not collapse into a Git-object-store failure. Filesystem
presence and source-control status are not Git-object authority, so correcting
current canonical identity does not require committing the record unless a
separate supported operation says so. A fresh dispatch after such a correction
is a new action; it does not resume or recover the refused action.

The process-local run registry is the sole current-run observation owner.
Immediate status and wait can observe a findings run while that backend process
retains it. After restart, an old handle may be unknown or expose separately
retained logs only; receipts and terminal artifacts do not reconstruct it. Such
artifacts are optional audit evidence, so absence or write failure cannot change
the run outcome or suppress a later dispatch. Implementation and integration
receipt, settlement, recovery, allocation, persistence, and CAS behavior remains
unchanged.

Every findings dispatch is a fresh independent advisory action. A failed action
is not repaired or resumed, and neither its failure nor any historical result can
select, satisfy, suppress, or veto a later action.

Slice-level standalone admission authenticates the parent WK as immutable review
context, not as the executable selected unit. Canonical nonempty parent criteria
with an intentionally empty validation array are therefore admissible draft
review material. The selected slice's acceptance remains complete and strict.
Malformed parent material, malformed or incomplete selected-slice acceptance,
moved identity, wrong role or effective scope, and caller-supplied locators or
authority still refuse before allocation, materialization, or spawn. Bare-WK
reviewer and redteam calls remain strict because the parent itself is the
executable selected unit.

Before a canonical exact implementation target becomes an immutable findings
target, the launcher proves that both selected identities are commit objects,
that the base is an ancestor of the reviewed commit, and that the reviewed commit
and base still equal the canonical selected-delivery binding. Missing objects,
reversed and disjoint ranges, a mismatched binding, and movement during the proof
retain distinct owner reasons. Only after the final binding recheck may routing
mint a source carrier or materialize a snapshot.

The route classifier admits exactly five semantic role/subject forms:
standalone reviewer slice, standalone redteam slice, exact implementation-slice
reviewer, bare-WK reviewer, and bare-WK redteam. It derives them from canonical
schema and production classifier semantics; `review_purpose` does not mint a
separate lifecycle subtype. Effective `write_scope: []` alone selects findings,
while a nonempty authenticated scope alone selects implementation. Missing,
malformed, mutable, caller-substituted, or otherwise unauthenticated scope and
locator facts refuse before effects.

Reviewer and redteam are both read-only findings identities, so the material
target's own declared scope is not a role restriction. A redteam or reviewer
request whose selected implementation slice declares nonempty effective write
scope is an ordinary current target: that scope selects the exact
implementation-slice material, while the findings action's own authenticated
mutation authority stays empty. A valid `work_kind: "review"` unit is a current
target for the same reason. Before any selector runs, the route authenticates
the canonical subject itself — the record is read once through the canonical
reader, must be a plain object whose `id` is exactly the requested WK, and a
requested slice must be selected by exactly one well-formed entry of a present
`slices` array; see [Runtime contract › Immutable advisory-review
target](mcp-dispatch-runtime-contract.md#immutable-advisory-review-target).

Migration-review acknowledgement does not participate in read-only findings
admission. Acknowledged and unacknowledged units with otherwise identical
canonical bytes have identical findings admission. Nonempty-scope
implementation dispatch retains the existing migration policy.

## Configured readiness and native permission diagnostics

The subject-free capability preview of `start_agent` reports configured
capability/readiness.
Normal Claude launch validates and applies native permission configuration but
does not empirically certify installed-runtime behavior. It runs no auxiliary
model-driven permission test and requires no synthetic report, canary or positive
cache. Genuine settings, executable, confinement and MCP setup failures retain
their ordinary stage-specific diagnostics. Explicitly opted-in integration tests
own empirical checks; see [Claude permission configuration and empirical tests](claude-native-permission-probe.md).

## Reading the current dispatch selection

Use `start_agent({preview:true,role})` for configured capabilities without a
subject, or `{subject,preview:true}` for the selected action's readonly planning
facts. Previews do not launch or integrate; unevaluated facts remain unchecked.
The retired identity-contract route is not an alias for these previews.

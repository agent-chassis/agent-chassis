# MCP integration

The production server registers the sixteen task tools as one composition.
`register-agent-task-tools.mjs` binds one trusted repository and the same prepared
launcher backend for start, pure result observation and explicit integration.
Incumbent authoring, source, transaction, executor, confinement, conduit,
provisioning, admission and policy owners retain their authority. There are no
public repository selectors, old aliases, help/router delegates or generic
spill-reader routes. Independently preserved operator-only tools keep their
existing owner implementations and tier filters.

## Standalone client configuration

Managed role sessions receive launcher-authored client registration and a prepared
backend. For an independent operator client, the following generic MCP client
configuration is illustrative; adapt the surrounding configuration key to that
client's own format and replace the absolute consumer path:

```json
{
  "mcpServers": {
    "wiki": {
      "command": "node",
      "args": ["/absolute/consumer/node_modules/@agent-chassis/core/bin/wiki-mcp"],
      "env": {
        "WIKI_MCP_WORKSPACE_DIR": "/absolute/consumer",
        "WIKI_MCP_TOOL_PROFILE": "operator"
      }
    }
  }
}
```

The executable and Node must be installed and reachable by the client. The server
requires an explicit supported role profile and one resolvable repository;
starting a bare binary without these does not establish a working deployment.
An operator profile exposes operator tasks, not managed agent start/execution.
This configuration has not launched a model or demonstrated managed dispatch.
No caller request may change the server's repository or grant a higher role.

Managed Claude and Codex use the launcher's private Unix-domain socket admission
service with a pinned stdio connector, not a standalone in-sandbox server or
named-FIFO relay. See [conduit lifecycle](agent-launch-mcp-conduit-lifecycle.md).

## Registration conformance boundary

[Operation reference](mcp-operation-reference.md#operations) names the exact
public task inventory. The central role/tier policy controls registration and
read selections. The actual serving request-contract store binds advertised and
enforced schemas; an owner's import or private registration is not public
adoption. Effectful unknown fields refuse before the owner can prepare or run.
Every emitted continuation must be granted and accepted by its serving consumer.

Shared input refusals preserve the validator's failing paths, messages, expected
types, enum choices, bounds and union-branch diagnostics within bounded population
and string previews. Counts identify omitted detail. Missing values remain caller
choices. A correction that only removes unsupported fields is offered when the
complete serving contract accepts it; no value is coerced or invented. Route-specific
input projectors take precedence. Refused input reaches no mutation or launch owner.

Save registration selects its diagnostic contract by the valid unit prefix and
save/retry shape before reporting nested failures. The shared authoring owner
reports the selected row's actual member path and type, enum, pattern or required
member constraint through the shared input projector. An inapplicable union
branch cannot invalidate a valid unit or supported change member. Missing authored
values remain caller choices; diagnosing a refusal does not relax the full validator.

Creation registration uses the same bounded input projector for every validation
refusal. A supported kind and object-shaped `initial` select the birth owner's
diagnostics at exact `initial` member paths, including caller-defined segments
and misplaced-member placement guidance. Other envelope failures retain the
bounded validator diagnosis, alongside birth diagnostics when both apply.
Invalid requests allocate nothing and execute no creation or maintenance.

Workers receive read/native/proof/result/delivery tools; delivery is the closed
empty `workspace_deliver_work` request authenticated by the launcher. Reviewer
sessions have authorized native/proof/result access, while redteam sessions have
read/discovery/assessment only. Paid code-index exposure is separate from free
substrate availability. Caller fields and prompts grant no authority.

## One host repository and one backend

Host configuration establishes exactly one repository through the existing
resolver. Missing or ambiguous configuration preserves that owner's refusal;
there is no first-workspace default or caller repo redirect. Native execution,
retries and originals authenticate against the same host repository.

`buildDispatchRuntime` creates one prepared dispatch backend using the existing
executors, provisioning and conduit/configuration owners. Start and result reads
share its exact session identity. Terminal settlement captures its permitted
original independently of reads. Start, child exit, waits, result observation and
saved dispositions never integrate work. Only explicit `integrate_work` for the
selected authenticated delivery reaches the integration effect owners.

## Result channels and selected originals

The shared response owner produces `content` and `structuredContent` from the
same canonical value. Admission measures the larger representation, including
JSON escaping and returned calls; physical serialized wire size counts both
representations separately. A compact first answer identifies the semantic
resource and exact next selection. A full selection authenticates the returned
reference and delivers the owner's permitted structured projection through the
selected-full class. Callers perform no base64, integrity or reassembly jobs.
Raw process logs have no public route. The only native-output exception is
`workspace_run_test`, with 1,024 UTF-8 bytes total per response.

`workspace_read_wiki` composes saved/canonical/document/search/assignment/package
owners and delegates create/save/candidate/publication/landing originals to their
authenticated owner. `get_run_result` delegates native/proof/delivery/integration/
observation originals. Neither facade adds a generic public owner router or a
second storage/selection engine. Original reads are pure, including after restart.
Missing durable evidence and corrupt or foreign sources remain explicit causes.
See [selected responses](mcp-selected-response-details.md).

## Authoring, assessment and proof discovery

Create with the closed kind-specific `workspace_create_record` contract; save
with `save_record({unit,revision,changes})` using the current combined revision.
Both publish compact declarations: the nested grammar of a creation is read
through a record kind's reference and that of a save through a saved unit's,
each in one selected read.
The existing transaction retains native atomicity, certainty and maintenance
rules. Malformed and stale saves do not silently rebase. Assessment shares its
owner with authoring and executes no proof provider. Saved dispositions remain
advisory input without integration effects.

`save_record` acknowledges success or no change with the resulting same-unit
write revision. Issued request-key bindings preserve newly allocated public
obligation, case, slice, entry and disposition identities when needed
for a dependent edit. Requirement, verification, collection and criterion selections reuse
caller-known authored meaning; compiler identities stay private. New entry/version
associations remain available. Select existing criteria by exact authored text or
an actually authored `typed_identity`; criterion amendments use `target`, removals
use selectors, and obligation associations take selectors or same-request `$key`.
Selections resolve before edits; explicitly restated associations follow surviving
criterion movement. Removed or mismatched associations need explicit compatible
changes. Derived criterion identities and movement maps stay private. A successful save
requires no current read, assessment or receipt retrieval. Automatic assessments,
successful checks (including advisory warnings) and source/retention bookkeeping
stay internal. Nonblocking advisory warnings also stay internal beside a failed
maintenance verdict. Return the deciding errors and the check owner's scope;
an undiagnosed failed verdict cannot offer an unchanged execution retry.
Recovery gives the specific cause and a task-level correction or stopping point;
internal component names and capability labels remain private, including in
historical reads. Stable diagnostic codes and issued continuation references
remain public where they identify the failure or enable its supported correction.
Partial cleanup retries preserve their actual removals beside the remaining
affected subjects and specific failures. Refusals retain actual publication
effects without routine lists of operations the save never performs. Where a save
issues bindings, an exception consequence or a consequential failure, its optional `saved_outcome` call
reads the authenticated historical save meaning, not the stored execution carrier.
That read repeats no mutation or checks and supplies no current write authority.
An unavailable current reader is a specific limit on stale-write recovery.

Requirement amendments use `target` with an exact semantic requirement or claim
selection; collection amendments use an exact collection selection. New rows use
request-local `key`. Collection members use requirement selections;
`remove.requirements` accepts requirement or claim selections, and
`remove.collections` accepts collection selections. Obligation
`claims` accepts requirement, claim and verification selections or existing
same-request `$key` references; `case.verification` accepts a verification selection
or verification `$key`. A whole requirement association selects its assertions;
its verification is a separate explicit association. All selections resolve
against the same captured pre-save source under the supplied revision. Missing or
ambiguous targets refuse without guessing. The final publication fence still
checks the revision. No successful save requires a follow-up read.

Native contract-validation failures retain every distinct deciding constraint
with its authored subject and correction field when those associations are
established. Several associations remain explicit choices; unavailable attribution
states its uncertainty and stopping point. Compiler identities, diagnostic
projection metadata and duplicate attribution inventories are private. Creation
uses the same native diagnostic meaning.

When the source owner rejects a path in a submitted repository-path or code-symbol
identity during save preparation, the refusal identifies the authored field,
rejected source and native restriction. Nothing was published. Correct a mistaken
identity without dropping other intended changes; an intentional source at a
refused path is a stopping condition, not authority to bypass source confinement.
`save_record({unit,maintenance_observe:{save_result}})` observes the current
maintenance of that authenticated original. It writes nothing and runs no checks.
Busy responses offer this observation after progress, rather than another
maintenance execution. A running intent without a recorded completion may still
be active or interrupted; the reader does not invent a verdict.

After an entire acknowledgment or issued mappings are lost, use
`save_record({recover:{request:<exact original save request>}})`. The server
correlates the original request with authenticated retained operation state;
this request is never executed. Resulting identities and revisions come from
that state, never from row order, prose or a current-record reconstruction.
Multiple matching operations expose known subject/effect choices with exact
observation calls where an issued unit identifies one operation. The optional
`recover.unit` is that caller-selected issued subject. Multiple operations on
the same subject can remain ambiguous. Missing, unreadable or unrecorded evidence
does not establish nonpublication and never authorizes replay. This lookup does
not recover operations that were never retained with a request binding.

If necessary response detail exceeds ordinary delivery and no
authentic retained source can be read, the response preserves publication and
explicitly stops dependent authoring instead of returning a partial identity map
as complete. Available diagnostic codes, subjects and causes remain immediate;
unavailable complete detail is an explicit stopping condition. A retained
operation outcome can supply complete delivery without a compulsory detail read.

Persistence failures expose their specific diagnostics and actual partial
effects: distinct participant publication states and artifacts already published,
removed or unsuccessfully removed. Whole record snapshots, artifact census,
successful retention checks and persistence execution traces stay internal in
both immediate responses and historical reads.

Production create and save both receive the existing wiki-core `generateAndLint`
executor. Applicable publication runs repository generation and lint once after
the canonical settlement, recording the check owner's actual captured source.
A saved or created record remains published if checks fail or cannot run; the
maintenance result preserves that cause separately. The returned
`save_record({unit,maintenance_retry:{save_result}})` call uses the immutable
producer receipt and runs only failed, unknown or not-run maintenance. It repeats
no creation or save. Refusals, no-ops and retries of durably settled successful
maintenance run no checks.
Initial authentication failure of a maintenance retry explicitly reports that
this retry ran no checks. It makes no claim that the original save or creation
had no effects. Failures after invocation retain the check owner's actual or
uncertain effects; they are never reclassified as initial nonexecution.

Artifact cleanup that failed after canonical publication is a separate pending
maintenance member when its retained subjects are known. A retry uses the same
record-owned artifact cleanup and reference census under the same write lock.
It attempts only retained unfinished subjects, respects current references and
does not rewrite the record or rerun successful generate/lint checks. A completed
cleanup is no longer presented as outstanding; its initial partial effects stay
available in historical meaning.

A completed check verdict can coexist with an executor exception after checks.
Save and creation responses preserve that exception separately from the completed
verdict and known generated-view effects, including on inspection of a settled retry.
The current maintenance carrier does not identify the failed post-check phase,
so the response does not infer it from the exception's text. No supported call
repairs that post-check failure; rerunning successful checks or replaying the
save is not its recovery. A retry with no pending checks reports
`no_retry_needed` without discarding a readable retained post-check failure.
The native executor releases its in-memory snapshot before the release
instrumentation callback. A callback exception after that release establishes no
remaining resource or cleanup action. Preserve its specific cause and completed
check/generated-view effects; do not manufacture a retry or expose routine release
bookkeeping. Observation after an entirely lost acknowledgment retains this same
meaning and never reruns checks.

When creation observes later source movement, it withholds the obsolete revision.
A dependent edit requires the caller to choose its intended `for_changes` members
on the returned bulk-read template, then use `contexts[unit].revision`. Creation
itself is complete; that context read is conditional on further editing.

Maintenance reports execution independently of coordination persistence. Retained
outcomes and observations can establish completed checks even when a coordination
replacement was lost. Reading them runs nothing; retry reconstructs only necessary
coordination and executes remaining work. It never repeats a known completed check.
If all needed work completed, a coordination failure alone adds no agent recovery
step. Where work or certainty remains missing, the public response preserves the
specific failure, affected members, known effects, uncertainty and supported
recovery calls. Captured-source facts or retained-result
references appear only when needed to understand the failure or take the next
step. Successful check inventories and server bookkeeping stay internal, including
behind historical reads; additional task-relevant historical meaning remains
readable through the save owner's supported original read. No partial success or
distinct member failure is hidden. That attempt is not claimed durably settled.
The authenticated original remains the explicit maintenance-only retry boundary;
no automatic replay occurs. A missing index alone proves neither nonexecution nor
failure: retained observations are consulted before any remainder execution. When
no retained evidence establishes the completed work, recovery reports that limit
instead of using another execution as observation.

`check.ran` records executor invocation. An absent executor or an established
failure before invocation reports `not_run`; an invoked executor that throws
without phase facts reports an unknown outcome and unknown generated-view effects.
The native executor carries its observed phases: completed generation remains
`generated_views: "regenerated"` when lint subsequently throws. Lint then has an
unavailable verdict, its original cause and no invented lint or proof success.
Captured corpus identity identifies the input read, even when lint was unavailable;
it does not establish successful validation. Historical observations remain immutable.

The operator's current `generate_and_lint({dir,max_findings})` route accepts a
nonnegative integer cap: omission keeps the compact 20-finding default, zero
returns counts only, and a positive value returns that many findings in producer
order, with exact full totals and truncation status. Follow the returned same-route
`max_findings` recovery to request the full population. If the requested result
exceeds ordinary inline transport capacity, a compact summary supplies a
`generate_and_lint({dir,original:{ref_id}})` selected-full read of the retained
result. That read authenticates the producer route and directory, works after
restart and performs no generation or lint. It returns the complete historical
result without the inline byte ceiling through the existing selected-response
owner; it is not a fresh observation.

`workspace_find_proofs` supplies the complete catalogue when called with no
arguments, complete lexical matches for an optional query, and source-authenticated
semantic selections. Lexical tier is no eligibility verdict: compare complete
assertion, exclusions, capability and applicable family facts across plausible
candidates and abstain on missing facts or ambiguity. Ranking, provider context
and catalogue currentness remain with the discovery owner. `query_code_index`
retains the delivered published-index/currentness contract and selected response
owner, including large complete semantic answers.

## Start, integration and candidate lifecycle

Start resolves saved canonical intent and configured model choices. Previews
preserve readiness/currentness limits and perform no spawn. Missing-base recovery
names the actual root unit, combined revision and required operator branch choice;
no branch is guessed. An accepted start emits the schema-checked common result
call for that subject and exact attempt.

Explicit integration authenticates the original delivery and repeats its live
commit/base/ref/source fences before effects. Saved review dispositions reach
configured policy intact but do not approve integration. Inspection and landing
observation are pure; candidate advancement and publication are separate explicit
mutations. Local/no-origin, plain Git and hosted handoff remain configured routes.
Publication does not merge or complete work; canonical completion is explicit
save with native checks and receipts.

## Failure and authority

Refusals preserve the deciding cause, subject, actual effects and supported fix.
No generic success, swallowed failure or unavailable-as-empty response is invented.
Authentication precedes selected-original content. Producer and stored schema
identities remain unchanged even where a public route name changed. Complete
selected originals never grant source, role, integration or lifecycle authority.

## Controlled-contract validator startup

The wiki MCP server's controlled-contract surfaces compile no JSON Schema of
their own, and exactly one wiki-core module loads that validator.
`packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs` is
the sole owner of controlled-contract package resolution and evaluation-input
validator loading; it resolves the validator from the repository-local
compiled-validator cache exported as
`@agent-chassis/controlled-contract/validator-cache`, which is the single owner
of Ajv construction, schema compilation, cache identity, regeneration, and
failure policy for both packages.

`packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs` used to carry a
second copy of that loader — its own package import, its own schema read, its own
validator-cache import, and its own `wiki-core.controlled-contract-tool-shared`
evaluation-input group over the identical schema, which compiled the same bytes
under a second group identity and published a second artifact for them. It now
forwards `loadControlledContractPackage` and `generationEvaluationInputValidator`
to `package-runtime.mjs`, so every existing importer keeps its exact call shape
while one schema is compiled under one declared group. Only
`wiki-core.controlled-contract-operations.evaluation-input.v1` is declared in the
package's validator population; requesting the retired tool-shared identity is a
typed `validator_cache_group_undeclared` refusal rather than a silent second
compilation.

Every memoized loader on that path — the package import, the proof-plan-request
schema read, the evaluation-input schema read, the evaluation-input validator,
and, inside the cache, its toolchain identity, its population pass, its
population status, and each per-group resolution — settles through one named
evict-on-rejection mechanism owned by
`packages/controlled-contract/lib/compiled-validator-cache.mjs` and exported as
`createEvictOnRejectionMemo`. Concurrent callers still share one pending attempt
and a successful load is still cached for the life of the process, but a REJECTED
attempt is evicted before the next authorized attempt, at every layer of the
chain. A transient fault — a read that lost a race with a concurrent publish, a
generation worker killed on a full device — therefore no longer poisons the
memo so that every later caller in the process replays the same rejection. This
is settlement policy only: it adds no circuit breaker, no retry or backoff
framework, and no public recovery action, and whether to attempt again remains
the caller's own authorized decision.

An exact cache hit loads generated validator code without constructing Ajv, so a
warm server process reaches controlled-contract readiness without the schema
compilation that previously dominated its startup. Reuse is decided per
compilation group, on a shared toolchain identity plus that group's own schema
digest; no source-tree digest participates, so editing a module that declares no
schemas invalidates nothing. A miss runs one generation pass in a worker that
compiles only the groups whose artifacts are absent or invalid, publishes each
atomically under the fixed `.cache/controlled-contract/validators` suffix of the
writing repository root, and loads those exact artifacts. The process working
context supplies its enclosing `.git` root once; package schema and runtime
bytes determine identity but the installed package and its `node_modules` tree
own no mutable cache state. Caller input, prompt text, MCP request content,
`HOME`, `XDG_*`, `TMPDIR`, and environment policy never select executable cache
content. Retired package-installation caches are not read or migrated, and no
cached code runs before its identity, containment, file type, and code digest are
verified.

Outside a writing repository, declaring validators still succeeds and each
refuses when called with `validator_cache_root_unresolved`, so importing the
packages, `--help`, and repository-independent discovery work from any directory.
The proof-intent metadata the controlled-contract package exports is validated
when the package is built and ships as `proof-intents/metadata.v1.json`, bound to
the sha256 of its inputs; import checks that binding and refuses a stale or
missing artifact rather than validating or compiling. Read-only proof catalog
search uses that packaged population and one package-built, digest-verified
result validator, so it answers identically inside and outside Git. Discovery
and selection do not repeat full derivation at import. Selection parses its
catalogue, profiles, and admissions from the exact source bytes checked within
one metadata capture, preserving catalogue order and taking profile/admission
digests from that same document's discovery provenance. Exact profile id and
version bind provenance to the complete admitted population; duplicate,
mismatched, and missing identities refuse in that precedence and in code-unit
identity order within each class. The frozen meaning supports synchronous
selection and authoring; those cache-bound calls still require validator
availability and refuse with `validator_cache_root_unresolved` outside a writing
repository.

Full semantic metadata parity remains the build owner's responsibility through
`build-proof-intent-metadata.mjs --check`. Startup retains input-hash and packaged
result-validator integrity checks; it does not independently detect arbitrary
hand edits to metadata bodies/input lists or changes to unhashed derivation/schema
code. For provenance refusals, a package maintainer rebuilds with
`npm run build:intent-metadata` in the writing repository; an installed consumer
installs or reinstalls a corrected package.

Managed dispatch ensures that same cache immediately before it invokes the
family executor, so a launch never pays schema compilation inside the spawn.

This is a startup-cost change only. Conduit ordering, acknowledgement timing, MCP
byte forwarding, authentication, generation ownership, client timeouts, retries,
and close classification under `decision` are untouched. Operators who want to
warm the cache ahead of a launch, or to diagnose one, use
`node packages/controlled-contract/bin/prepare-validator-cache.mjs` as described
in the repository-only runbook
`the project documentation`.

## Transport

MCP clients receive a stdio command. For confined Claude and Codex roles,
`decision` (repository-only: `wiki/decisions/decision.md`) requires a
launcher-owned private
Unix-domain socket adapter. Each command invocation opens one independent
connection and, after authentication, receives one fresh host wiki-MCP process,
protocol session, readiness observer, and lifecycle settlement. Connections may
overlap; they do not share a protocol byte stream. This is a server per MCP
command invocation, not per tool call or per whole dispatch. Direct unconfined
stdio may connect to a directly spawned server. Named-FIFO relays are not a
supported confined transport.

The launcher establishes admission before the confined client starts. It creates
the socket and mode-0600 credential file beneath a private mode-0700 root outside
repositories and worktrees. Bubblewrap projects the endpoint and credential at
`/run/agent-launch/mcp.sock` and `/run/agent-launch/mcp.token`, together with the
launcher-pinned connector and the exact Node executable running the launcher.
The host wiki-MCP server and its dependencies remain outside the namespace.

The client registration is frozen by family:

- Claude receives launcher-authored `--mcp-config` plus
  `--strict-mcp-config` and the role-derived `mcp__wiki__*` allowlist.
- Codex receives only launcher-authored `mcp_servers.wiki` command and args
  overrides in an isolated runtime home.

Both registrations run the same pinned stdio connector. It connects to the fixed
socket path, proves possession of the launcher-minted credential, and waits for
the admission acknowledgement before reading and forwarding client stdin.
Admission spawns a server only after authentication and acknowledges only after
that generation registers and becomes ready. It forwards bytes between that
connection and the server's independent stdin/stdout pipes. The credential
authenticates the already-bound launch and carries no role or routing authority.
There is no TCP, HTTP, remote listener, or URL-based MCP registration.

Each server reports its exact registered tool surface on a launcher-only pipe.
The real client must then complete MCP `initialize`, send `initialized`, and
request `tools/list`. Admission remains available for independent connections
until teardown. Rejected authentication creates no server generation; a failed
generation is settled through its own lifecycle. Conduit teardown closes
admission, settles every owned generation once, reaps owned processes, and
removes endpoint and credential state. Readiness, expected transport EOF,
abnormal server loss, and cleanup classification are detailed in the
[conduit lifecycle](agent-launch-mcp-conduit-lifecycle.md).

For reviewer and redteam, the expected set comes only from the launcher role
profile and configured tier. Reviewer receives the execution and result tools;
redteam receives only its advisory reads and assessment. Both exclude the
operator-only `workspace_frozen_review_contract_query`. Readiness compares the real confined
client's returned `tools/list` exactly: missing and extra tools both fail before
inference. The reduced population does not make any tool optional. Host
registration, configured lists, and in-process registry projections are not
client-surface proof.

Lifecycle compatibility is established by the host wiki-MCP process that was
actually spawned. Its initial launcher-only
`wiki-mcp-launcher-readiness.v3` registration includes
`lifecycle_protocol_generation: stdio-mcp-conduit-lifecycle-vocabulary.v3`,
loaded from that process's conduit contract. The long-lived launcher compares
the announcement with its own loaded generation. No request field, environment
value, filesystem fingerprint, backend generation, or historical state supplies
the comparison.

The generation names the whole launcher-only event grammar — schema versions,
required keys, permitted keys, and exact values — so any grammar change moves the
producer and consumer generations together, and new evidence takes a new schema
version instead of a new key on an existing one. Because the local transport does
not spawn the host server until a confined client has authenticated, the launcher
additionally probes the ON-DISK producer in one short-lived process immediately
before conduit construction, and refuses a mismatched or unreadable producer
there — before the family executor can spawn a confined worker, reviewer,
redteam, or orchestrator.

Only equality permits initialize and exact `tools/list`. Old, missing,
malformed, unknown, or incompatible generation evidence returns the existing
`stdio_mcp_lifecycle_protocol_incompatible` blocker and bounded
coherent-build/restart detail. The projection preserves that originating modeled
startup identity; it does not replace it with `operator_recovery_needed`.
It authenticates no delivery, creates no review or integration transition, and
opens no retry or fallback.

For each generation, the launcher enforces its own phase machine:
await server registration/generation, server compatible, await initialize,
await exact `tools/list`, ready, client closed, and terminal (or failed).
Duplicates, close-before-readiness, evidence after close, unknown schemas, and
impossible transitions preserve the first typed failure and use the same
exactly-once cleanup settlement.

The first typed transport or tool-surface failure remains primary through child
settlement, receipt persistence, restart, status/wait, and provenance. A zero
exit or captured but invalid child payload cannot replace it with success;
`role_outcome_mismatch` is secondary diagnostic evidence only. Such an attempt
records no usable verdict, consumes no review obligation, changes no
implementation state, and cannot veto a later independently authenticated
attempt.

The public dispatch-facing taxonomy is registered in
`packages/wiki-core/data/runtime-blocker-codes.v1.json`. Construction and
binding codes include `stdio_mcp_conduit_input_invalid`,
`stdio_mcp_conduit_family_unsupported`,
`stdio_mcp_conduit_private_root_unavailable`,
`stdio_mcp_conduit_directory_invalid`,
`stdio_mcp_conduit_fifo_create_failed`, `stdio_mcp_conduit_fifo_invalid`,
`stdio_mcp_conduit_fifo_identity_mismatch`,
`stdio_mcp_conduit_binding_consumed`, and
`stdio_mcp_conduit_stdio_shape_unsupported`.

Host-server failures use `stdio_mcp_host_server_unavailable`,
`stdio_mcp_host_server_start_failed`,
`stdio_mcp_host_server_readiness_failed`,
`stdio_mcp_host_server_startup_timeout`, and
`stdio_mcp_conduit_server_exit`. Exact role/tool verification uses
`stdio_mcp_tool_surface_mismatch` and
`stdio_mcp_client_tool_surface_mismatch`. Client lifecycle failures use
`stdio_mcp_client_readiness_failed`,
`stdio_mcp_client_readiness_timeout`, and
`stdio_mcp_client_relay_restarted`.

Namespace and teardown failures use
`stdio_mcp_conduit_requires_bubblewrap`, `stdio_mcp_conduit_cancelled`,
`stdio_mcp_conduit_cleanup_failed`, `stdio_mcp_conduit_reap_failed`, and the
family-neutral terminal projection `stdio_mcp_cleanup_failed`. Some retained
identifiers contain `fifo` or `relay`; their names do not establish a supported
FIFO transport. Production composition selects the local socket channel.

## Registered request contracts

The same owner schema is advertised and enforced. Where SDK tool declarations
require one object, the owner supplies a closed advertised object while the
registered union/refinement enforces mutually exclusive forms and cross-field
rules. `registeredToolRequestContracts` is the serving consumer authority for
producer continuations. Registration, grants, descriptors, selected reads and
role guides describe the same current contract. Displaced agent routes are
absent and non-callable in source and selected installed packages.

A registration may also declare an input schema exposure: the owner's own JSON
source schemas with navigation metadata. `input-schema-exposure.mjs` is the
pure derivation helper. From one source it selects any members, by name, by
group, or both in one selection, and returns each selected member exactly as
the owner declares it, the owner object's own constraints, and every local
definition the selection reaches, in the owner's order. It converts, factors
and shortens nothing, applies no size bound to a selection, and refuses an
empty, unknown or malformed selection and any reference it cannot follow. A
group is navigation metadata, not a required sequence of reads, and each
source member has exactly one group.

The construction owner keeps the serving requirement batch concise: accepted
type, relation and applicability terms use enums derived from the same owners;
their complete definitions remain in requirement guidance. Shared obligation
statement, criteria, claims, proof and case nodes are local definitions rather
than repeated bodies. Exposure still returns the entire selected owner schema,
with every reachable definition and constraint. A held schema stays usable
across record revisions; optional job reads need not be repeated after saves.

`save_record` declares its four per-variant `changes` sources (work item, work
item slice, initiative, decision) through `save-record-input-exposure.mjs`; the
variant's own source decides which members exist and apply. The registrar binds
a declaration before the SDK registers the tool and retains the binding with
the request contract only when registration succeeds, per registrar; a
declaration that differs from the retained one is a conflicting registration.
A source's digest includes its whole schema and any capability/guidance exposure
metadata. It is independent of the record revision. Owner-published requirements
capabilities scope both syntax and operators at construction; the generic helper
selects their transitive local definitions and the matching guidance. Unscoped
reads retain complete members, and the full validator is unchanged. See
[requirement selections](mcp-selected-response-details.md#save-input-contract-selection).
The binding keeps one reference graph per declared source and remembers no
selection.

Sharing a repeated definition is the source owner's act, before binding. The
work-item and work-item-slice `changes` sources state each owner object they
place at more than one position once, as a local definition in the source's
own `$defs`: the case object of an obligation row (`obligation_case`), which
both variants of the row refer to; the definitions of the one requirement
batch, which its owner states once and both sources carry as their own — the
entity id every use names (`entity_id`), the entity declarations
(`entities`, `entity`, `entity_declaration`, `type_term`, `identity`), the
role-specific statements (`behavior` for requirement behavior and behavioral
failure conditions, `observation` for verification observations), with their
applicability and operand forms, the two row forms (`requirement`,
`membership_requirement`) and the one verification both carry
(`requirement_verification`), `collection` and `unresolved_meaning`; a case's `case_component`, `case_target` and
`case_falsification`; and a ready slice's `ready_slice_edit_targets`. Each
definition is a concrete body, the owner's own node with every constraint and
description it had inline; a body refers onward to the definitions it
contains, never to itself or to an alias. A reference is `#/$defs/<name>`
within the same schema, and the source's digest is the digest of the schema in
that form. Work-item birth keeps only the new-row grammar and shares its
repeated prose content carrier as its own `content_carrier` definition, and the
identical nullable provenance choice its ready-slice target facets take as
`edit_target_provenance`. Both bodies retain every owner constraint and
instruction; their references and definitions arrive in the same selected read.
Initiative and decision sources keep their inline owner representation. That shared schema is the one the save
validates a request against before any effect and the one the registered
request converter reads, so what a request may carry is unchanged; a refusal
names the caller's own member path and constraint, judged by the row variant
the request selects, and never a definition path. A selection that reaches a
shared definition returns it in the same result, so one selected schema is one
self-contained document and following a reference inside it is not another
read.

The binding is internal: it publishes nothing and adds no agent call. The
registered full input schema remains the only validator, so a selection never
widens or narrows what a request may carry, and reading one is never a
precondition of a call.

`save_record` publishes a compact declaration beside that validator. The
compact advertisement is a pure, shallow projection of the same owner sources,
made by `input-schema-compact-advertisement.mjs` and composed for the request
by `task-save-record-tools.mjs` through the registrar's published-schema
projection. The request envelope is published as the SDK converts it. Each
published `changes` alternative keeps every member name in the owner's order
and the object's self-contained constraints (its type, closedness, nonempty
rule and required names). A member whose declaration is a scalar type or a
closed set of scalar values is published exactly as the owner declares it;
every other member is deferred whole, published with the owner's description
and no constraint. The cut is structural, never by size, and no member is
published in part. The projection carries no reference and no rule about a
deferred subtree, so it only widens: every request the owner accepts is
admitted by the compact declaration, and the full validator refuses everything
else before any handler or effect. A deferred member's complete declaration is
read through the selected input contract of a saved unit, which returns the
owner's own nodes; the compact declaration is never the source of a nested
rule. The tool description states this, and a schema already read stays valid
after saves.

Semantic guidance uses the same authenticated reader and owner vocabulary;
it does not replace the selected input schema or decide whether a save is valid.
The selected requirement schema recommends `authoring_vocabulary`, a complete
job answer with shared definitions and one copy of each relation signature.
Every signature lists its allowed `behavior`, `fails_when` and `observes`
positions. A missing position forbids that relation, including observation-only
relations at behavior or failure positions. All operand and applicability
constraints are present in that answer; no external definition read is needed.
The separate `vocabulary` and `observation_vocabulary` topics remain complete
answers to their respective position questions.

An explicitly chosen proof `target_family` offers complete case guidance through
`workspace_read_wiki`: `['case_authoring','family',<family>]`. It states its scope,
common case meaning and every selected-family target, falsifier and example.
It retains association choices and ambiguity, cardinality, components,
observations, support states and bounds. The complete general `case_authoring`
topic remains available, and case answers offer other complete family selections
with the same reference. Neither query recognition nor an omitted family
silently chooses a family for this guidance. Saving still derives bindings,
validates authored meaning and reports drafts and refusals through its owners;
reading guidance executes no proof and grants no credit.

## Trusted runtime and CCE

Launcher/runtime owners enact provisioning, isolated child launch, frozen
assignment transport, exact delivery and integration. Role authority comes from
the authenticated launcher contract. The org policy profile and CCE gate retain
their existing authority; task composition grants none. Mechanical validity,
advisory review evidence and an authenticated configured policy decision remain
separate. See [enforcement](enforcement-model.md),
[launch and admission](mcp-dispatch-launch-and-admission.md) and
[managed lifecycle](mcp-dispatch-managed-run-lifecycle.md).

The current readiness registration requires `registered_tier` to name a known profile equal to the launcher’s captured host selection. Missing, unknown or mismatched profiles refuse that connection generation before readiness; the operator restarts the affected connection with coherent host configuration. Registration establishes no CCE admission or audit assurance.

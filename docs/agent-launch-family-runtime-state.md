
# Per-Family Launcher Runtime State

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page describes the four runtime-state classes and each family's launch
qualification. The launcher lifecycle is shared; runtime state remains
family-specific.

## Family Runtime State

The launcher **lifecycle** is converged — one shared
`superviseChildLaunch` child supervision / bounded capture / final-result path
used by supported families on the launcher-owned in-process path.
Runtime state is **not** converged. Codex's private `CODEX_HOME` and Claude's
credential/config mount are app-specific runtime facts, not a shared runtime-state
implementation. Agy provisions a private native home and retained conversation
state, and delegates launch authority, confinement and supervision to the same
shared owners.

The handle returned by `superviseChildLaunch` carries a result-free
`completion` promise alongside `probe` and `hasObservedChildTermination`. It is
the supervisor's existing stdio flush gate: it resolves with no value once a
terminal transition has been recorded and the watched stdout/stderr streams have
drained (or the child-level `close`, spawn-error, forced-timeout or bounded
post-exit drain path released them), and it never rejects. Awaiting
`completion` alone never calls `probe`, never invokes the family parser and
never captures the final result; the final result is still captured exactly
once, through `probe`. `completion` is terminal/drain readiness only. It is not
positive child-termination evidence — a spawn error or forced timeout resolves
it while `hasObservedChildTermination()` stays `false` until a real exit is
observed — and it grants no cleanup, settlement or integration authority. The
launcher wrappers pass the same promise through unchanged.

Run settlement initiated by monitoring or completion has one shared owner,
`settleAndProjectRunRecord` in `workspace-agent-dispatch-run-settlement.mjs`,
for worker and advisory records. Concurrent observers of the same run-record
object share one in-flight settlement promise and its projection; ownership is
released when that promise fulfills or rejects, and nothing settled is retained.
Distinct record objects settle independently. After identity binding and registration,
launchers subscribe once to completion of a nonterminal worker or advisory handle,
before acknowledging launch. Completion initiates capture through the record's fully
decorated probe, including existing conduit cleanup, result normalization and worker
publication. It joins an in-flight observation; if that frame remains nonterminal,
it then processes the terminal notification through the same owner. Already-resolved
completion works. Startup-terminal outcomes retain their launch-finalizer settlement
without another subscription, and accepted launch responses retain the startup snapshot.

The subscriber handles rejection and retains separate diagnostic evidence, preserving
captured child output and outcome if later settlement or advisory cleanup fails.
Completion grants no positive process-death or integration authority. Worker publication
still uses the authenticated execution tuple and existing journal owner; failed
publication retains process-local output and its cause, without crash-durability claims.
Advisory output remains process-local. Status and wait still initiate settlement;
pure-reader conversion, live publication correction and public cutover remain unchanged.

The journal store's internal synchronous `assessManagedRunResultPublication`
reads and validates the committed prefix, selects the exact run, and uses core
result admission with the original whole dispatch binding and complete result
digest. `already_recorded` means admission proved identical recorded binding and
payload; `append_admissible` means only that this observed prefix permits an append.
Neither classification publishes a result or authorizes a later append.
Read, selection and admission refusals retain their owner diagnostics; unexpected
throws propagate unchanged. Missing, malformed, unreadable or incorrectly bound
state and conflicting result bytes cannot classify successfully.

Assessment creates no directories or locks, writes no bytes, and performs no
retry, launch or integration. It can read a committed prefix while its partition
lock is held without acquiring or stealing that lock. A later
`recordManagedRunResult` revalidates through its existing locked publication owner,
which can refuse after an intervening publication. This capability provides no
automatic publication correction and does not activate a pure public result reader.

The settlement owner also exports internal `correctManagedRunResultPublication`,
with no production caller. Its required `assessPublication` and `publishResult`
dependencies compose the existing authenticated readback and locked publisher;
each receives the same complete `{subject, dispatchTuple, result}` request.
An identical recorded result succeeds as `observed` without publishing. Only
`append_admissible` permits one publication attempt, followed by one assessment;
only `already_recorded` on that assessment permits verified success.

The operation retains native assessment, publication and verification outcomes.
It preserves the publisher's `appended` flag: a new append reports `appended`,
while an intervening identical publication reports `observed`. Failures report
their stage and preserve owner refusals or complete thrown diagnostic evidence.
Known append effects remain separate from a verification failure; a publisher
throw leaves append effects unknown (`appended: null`). A still-admissible
verification fails with `managed_run_result_publication_not_observed`.
Readable journal bytes do not independently prove a completed disk-sync barrier;
the existing publisher's guarantees and failure uncertainty remain unchanged.

This operation performs no second publication attempt, child probe, launch or
integration and does not mutate its request or set result durability. The prepared
producer composition below supplies lifetime ownership; this subordinate operation
does not. Live publication and monitoring behavior remain unchanged.

### Prepared producer composition

`createPreparedWorkspaceAgentDispatchBackend(options = {})` in
`workspace-agent-dispatch-backend.mjs` accepts the same ordinary backend options.
It reuses backend assembly and selects `createPreparedDispatchRunLifecycle(ctx = {})`
in `workspace-agent-dispatch-run-lifecycle.mjs`. Neither constructor is selected
by current public registrations. The active `createWorkspaceAgentDispatchBackend`
and `createDispatchRunLifecycle` retain observation-driven settlement until cutover.

Backend assembly binds `publishManagedRunResult(request)` to `recordManagedRunResult`
and `assessManagedRunResult(request)` to `assessManagedRunResultPublication`, both
with its canonical managed main repository. These internal dependencies reach the
startup launch finalizer and the single shared completion subscriber. Managed
publication requires both owners; a prepared composition with a publisher but no
authenticated assessor refuses construction. No caller-carried repository or tuple
can replace the launch-retained execution binding used for publication.

`publishCapturedManagedRunResult` owns the record's lifetime: one initial attempt,
then at most one invocation of `correctManagedRunResultPublication`. Each publisher
call is reserved before awaiting it. Correction assesses before deciding whether
one locked append is admissible; a refused assessment never becomes an append.
There is no timer, observer retry, second coalescer or settled promise cache.
Missing or mismatched launch identity preserves the existing launcher repair facts
and attempts no publication. Advisory output remains process-local.

The immutable `result_publication` snapshots retain the original `result`, reserved
publisher `attempts`, `initial` outcome/evidence/append effects, and separate
`correction` outcome. States are `publishing`, `correcting`, `available` or
`unavailable`. Initial throws keep complete diagnostic evidence and unknown append
effects. Correction retains its stage, native refusals, verification and appended
true/false/unknown. Successful recovery makes current durability available without
erasing the failed initial attempt; exhaustion retains both causes and the exact
process-local result. Readable readback adds no independent disk-sync guarantee.

`projectCapturedRunRecord(record)` in `workspace-agent-dispatch-run-settlement.mjs`
uses the existing worker status builder or pure `projectAdvisoryProcess(record)`.
Prepared status and wait reuse exact selection and caller/subject authorization,
then only project retained state. `producer_pending` exposes in-flight settlement;
completion and settlement failures remain separate diagnostic evidence. Wait polls
within its monotonic deadline, including when a terminal child is still publishing,
and neither a timeout nor abandoning a wait cancels the producer. Reads initiate
no probe, append, correction, attestation, cleanup, launch or integration. Restart
readback uses the existing authenticated journal owner; no local output or old
handle is recreated when it is absent, and no publication budget is rearmed.

Coordinated adoption must select the prepared backend constructor in the shared
server composition and bind public readers to these observational methods. The
start schema/handler, material preview, root correction, result formatting,
explicit integration, route retirement/discovery/guidance and complete source and
installed adoption still require their respective owning changes in the joint
cutover. These constructors activate none of those public surfaces.

The shared part is the **vocabulary** used to classify per-family state, not a
shared code path. Each family's runtime state falls into one of four classes:

- **operator-owned source** — per-user state the operator
  authenticated/installed on the host; the launcher reads it (directly or by
  read-only mount/symlink) but never writes it.
- **launcher-owned per-run** — transient state the launcher mints per launch
  under its own runtime base; isolated per worker and safe to delete.
- **read-only mount** — host paths exposed to the worker bwrap namespace
  read-only (`--ro-bind-try`), never `--bind`.
- **writable runtime state** — host paths the worker may write during the run.

### Per-family runtime state

**Codex** (`setupCodexRuntimeHome`, `codex-role.mjs`):

- The launcher mints a private `CODEX_HOME` (`<runtime-base>/codex-home`) per
  launch under the runtime base (`CODEX_ORCH_RUNTIME_DIR` for orchestrated
  dispatch, otherwise the per-repo `runtimeDirFor` path). This is
  launcher-owned per-run state.
- Per-user source state is exposed by **symlink** from the operator source
  home into that private home, read-through by intent: `auth.json`,
  `version.json`, `models_cache.json`, `config.toml`, `skills`, `memories`,
  `sessions`. The source home is `CODEX_SOURCE_HOME` when set and non-empty,
  otherwise `~/.codex` (operator-owned source).
- Writable per-run directories created in the private home: `log`, `sessions`,
  `tmp`, `shell_snapshots`, `rules` (launcher-owned per-run). `sessions` is the
  one overlap: it is symlinked from the source home when that source exists and
  is otherwise created as a per-run directory.
- **Result source is `finalPath`**: the final answer is read from `final.md`
  under `<CODEX_HOME>/tmp/<run-dir>/`, written via Codex
  `--output-last-message`. This `finalPath` / private-`CODEX_HOME` pair is a
  kept Codex-specific fact, not permission to keep a separate launcher
  lifecycle or capture pipeline.

**Claude** (`workspace-agent-dispatch-claude-executor.mjs`):

The Claude executor's runtime paths are **derived from launcher-owned
host-home facts**, not a fixed `/home/user` prefix. The launcher
reads the host user home from the OS passwd entry for the
effective user via `os.userInfo().homedir`, never caller-supplied `HOME`,
`XDG_*`, inline env, or `PATH` manipulation) and derives the runtime facts below
from it, so a macOS host home such as `/Users/<user>` or a non-default Linux home
such as `/home/<user>` yields equivalent paths. The `$HOME` / `~` notation below
is explanatory shorthand for that launcher-owned operator host home; it is not an
agent-provided policy input.

- The worker bwrap exposes the real OAuth credential file
  `~/.claude/.credentials.json` as a single leaf-file bind drawn from the
  launcher's explicit accepted-path list
  (`CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES`). Normal implementation workers
  bind that file writable so Claude can persist OAuth rotation to the host file;
  exact findings roles bind it read-only. Writable OAuth state is necessary for
  consistent CLI operation and is not a separate credential-security posture.
- The versioned Claude install directory (`~/.local/share/claude`,
  `CLAUDE_FAMILY_RUNTIME_READ_ONLY_ROOTS`) is bound read-only so the binary is
  reachable, and the executable resolves under `~/.local/bin/claude`.
- The broad host home (`$HOME`), the `~/.claude` directory itself, `~/.config`
  (including `~/.config/gcloud`), and credential parent directories such as
  `~/gcp-credentials` are not mounted. The launcher projects only the runtime
  paths the Claude CLI composition uses.
- **Result source is `stdout`**.

**Agy**:

The adapter composes authenticated assignments, frozen result modes and scope,
commit credentials, delivery, the closed managed MCP conduit, kernel isolation,
readiness, supervision, cleanup and canonical results through the shared owners.
Managed executable preflight reads `agents.agy.base_argv` through the shared
registry resolver from the owning repository: the consumed advisory input's
`repository` or the validated worker provisioning's `main_repo`, also used for
conduit composition. The configured executable and leading arguments are
preserved. The disposable assigned checkout remains the execution cwd and
filesystem confinement target; it needs no launcher registry, and a competing
checkout registry cannot redirect execution. Missing or invalid owner
configuration fails before conduit/process acquisition with the owner path and
original diagnostic. Assignment and conduit authority are checked before that
configuration read. Operator start and exact-session resume use their own
repository for both configuration and execution. Guide delivery still uses the
existing role/selection and checkout context; external launcher runtime-state
resolution also keeps its existing checkout context and ownership rules.

Agy 1.4.0 native qualification uses `gemini-3.8-flash-low` with explicit `low`
effort. Its installed inventory also lists `gemini-3.8-flash-medium` and
`gemini-3.8-flash-high`; their matching efforts are checked at the argv/profile
boundary. No model is implicitly selected, and mismatched model/effort refuses.

Gemini 4 Argon is additionally registered as `gemini-4-argon-medium` and
`gemini-4-argon-high`, requiring matching `medium` and `high` effort. Agy 1.4.2
`models` confirmed these native IDs on 2026-10-19. The opt-in
`agent-launch.agy.argon.medium.toml` selects medium for all four roles with
high-priority guides, using the existing OAuth token convention. Registration,
profile resolution and argv fixtures do not qualify Argon native inference or
resolve the remaining managed registry-ownership/completion limitations.

Demonstrated fixture capabilities:

- Authenticated wiki-MCP reads; ordinary workers read allowed fixture bytes,
  edit exact granted files, receive kernel denial on sibling read/write, and
  deliver through the closed tool. Git objects, exact changed paths, unchanged
  sibling bytes and the retained delivery receipt are independently checked.
- Schema-selected workers pass the unchanged canonical result schema through
  `--json-schema`. Native `json_schema` and `structured_output` are checked
  against that schema and the shared result validator. Malformed and unsupported
  native schema inputs fail without changing the frozen result mode.
- Reviewer/redteam mechanics use the authenticated role conduit, selected guide
  and read-only kernel plan. Native reads succeed, attempted writes receive
  `EROFS`, files remain unchanged, and output is free prose. These are disposable
  mechanics fixtures with a diagnostic startup prompt, not repository reviews
  or downstream production review/settlement qualification.
- Headless orchestrator start and exact-ID resume perform wiki-MCP reads, honor
  the explicit log file and retain the selected model/effort. Interactive PTY
  startup, native trust confirmation, a subsequent operator wiki-MCP turn and
  exact-ID headless continuation also pass. Each invocation gets a new conduit
  and configuration while resume retains the same native conversation state.

The native runtime is outside the repository. Each invocation creates an
immutable private home with `.gemini/config/mcp_config.json` serialized from
`projectStdioMcpChannelClientRegistration`, and the selected complete guide as
`.gemini/GEMINI.md`. Native conversation/cache/project metadata is writable in
its own retained root, referenced from the private home. Only the existing
`~/.gemini/antigravity-cli/antigravity-oauth-token` credential leaf is exposed,
read-only; it is referenced by a private symlink, never copied into config or
environment. Interactive setup projects only existing onboarding-completion
booleans into private native state. No host settings, projects or sessions are
imported. Credential refresh that needs to change the host token is unqualified.

Existing workspace `.agents`, `.agent` and `.gemini` discovery directories are
masked through the shared builder. Competing fixture MCP/hook configuration
cannot add an effective server, execute its marker or widen source scope.
Native `--dangerously-skip-permissions` removes native prompting inside this
shared kernel confinement; it supplies no repository, delivery or role authority.
No native permission settings or enforcement hooks are introduced.

Headless output uses bounded native `stream-json` facts: exact conversation
identity, terminal status, response, schema fields and native errors. Exit-zero
permission denials and partial-output print timeouts do not produce final-result
success. Headless start, exact-ID resume and managed roles explicitly pass
`--print-timeout 0s`: Agy 1.4.2 defines zero as waiting for turn completion.
The adapter imposes no independent native deadline. The benchmark retains its
outer execution budget; managed roles retain the shared 45-minute run timeout
or their explicit `killTimeoutMs` override. Positive native timeout seconds are
available to diagnostic fixtures, without a new operator setting.

Headless Agy retains stdout in a private, invocation-owned `agy-native-*.jsonl`
file under the session runtime directory (`native_export_path` in `session.json`).
It opts out of the shared supervisor's 1 MiB stdout buffer. Capture writes chunks
without a growing memory buffer; the Agy-only reader consumes JSON tokens in
64 KiB windows, skips unused payloads, and keeps bounded completion fields. Tool
error recovery checks re-read later observations instead of accumulating session
history in memory. Headless start and exact-ID resume join that same recovery
interpretation to the private SQLite trajectory. A historical error is accepted
only for a matching conversation and native step index: SQLite GENERIC/ERROR
(`132`/`7`) with error bytes, corroborated by a stream `tool` in `ERROR` with a
matching tool name and `TOOL_ERROR`. A later clean `DONE` observation of the same
operation must precede the clean terminal response and match a clean SQLite tool
row. Operation matching retains the native contract: MCP calls compare server
and tool identity, while other tools compare native parameters. An unrelated
success or an earlier success cannot recover a failure.

Both sides exclude indices at or below the resumed invocation's
`afterStepIndex`; prior history or a prior export cannot forgive a current error.
The idle summary, workspace/conversation identity, clean final SQLite response
and matching indexed stream response remain required. Unclassified, missing,
conflicting or unresolved error evidence refuses, as do provider errors,
permission denials and malformed terminal records. Native `SUCCESS` alone grants
no completion or benchmark-score credit. At most 2048 small SQLite rows are
retained for the join; the export is never loaded whole. Session diagnostics
record recovery/unresolved counts and at most 16 step facts per category, without
tool output or error messages. Historical errors remain in the original export
and databases. Shared supervision, authority, settlement and result normalization
keep their existing owners.

The native export ceiling is 1 GiB (1,073,741,824 bytes), inclusive. Exceeding it
fails with `agy_native_export_size_limit_exceeded`, retaining the permitted prefix.
Write, stream, drain, log-retention and read failures have distinct
`agy_native_export_*` reasons. The complete export is retained for successful and
failed sessions below the ceiling; files are mode `0600` and descriptors close on
all exits. Native output is not added to wrapper stdout. The existing evidence
exporter retains the file with the session runtime tree, under its existing
credential exclusions and redaction rules.

Shared supervision, stderr capture (64 KiB), stderr logging, cancellation and
usage accounting remain unchanged. Agy drains and syncs its export before reading
completion; a malformed or incomplete export and a provider `ERROR` remain
failures, including after publication. Stderr capture failures retain the shared
`native_completion_capture_incomplete` diagnostic.
A native print-timeout warning yields `agy_print_timeout` even for exit zero and
`SUCCESS` with empty or nonempty partial prose. The recorded process exit facts
remain unchanged. The shared process owners handle cancellation, timeout,
spawn/early exit, conduit failure and cleanup. Interactive identity comes from the private
Agy SQLite summary and trajectory databases; resume validates the retained exact
ID, repository, schema, native root and last step before acquiring a conduit.
There is no latest/global conversation lookup.

Current limits:

- Interactive launches have no headless export to corroborate indexed tool
  recovery. They retain the strict all-clean SQLite completion predicate; a
  recovered historical tool error can therefore still prevent interactive
  completion. Headless exact-ID continuation evaluates only its own new steps.
- Agy 1.4.0 can construct its first interactive prompt before MCP discovery has
  populated its conversation. The demonstrated wiki read uses an operator turn
  after discovery; automatic first-prompt MCP availability is unqualified.
- Only explicit `high_priority_role_guide = true` delivery is qualified. A guide
  over the native 24,000-byte per-file limit refuses. Full guide bytes are
  delivered at startup; behavior after actual automatic compaction or `/clear`
  remains unverified. Clearing can create another native identity, which the
  invocation-private identity reader refuses as ambiguous rather than choosing
  one. Lower-priority reminder delivery is unqualified.
- Agy 1.4.2 with `gemini-3.8-flash-medium`, effort `medium`, completes a
  deterministic 95-second native operation and then an authenticated wiki-MCP
  read under explicit native timeout disablement. A diagnostic 15-second native
  timeout is classified through the managed launcher as `agy_print_timeout`.
  These bounded fixtures do not establish full benchmark completion, high-effort
  inference, host-token refresh, downstream production dispatch/settlement or
  long-session state housekeeping.

Operator commands, from a repository with the initiative present:

```sh
npx agent-launch orchestrator initiative --model gemini-3.8-flash-low --effort low
npx agent-launch orchestrator initiative --model gemini-3.8-flash-low --effort low --headless --log-file /tmp/agy-orchestrator.log
npx agent-launch resume initiative --model gemini-3.8-flash-low --effort low --headless --log-file /tmp/agy-resume.log
```

The operator must select `high_priority_role_guide = true` in the applicable
`agent-launch.toml` role table (`roles.orchestrator`, and each managed role used).
The executable registry must resolve `agents.agy.base_argv` to the installed
Agy executable, for example `["/home/user/.local/bin/agy"]`; the shipped entry
`["agy"]` works when that binary is on `PATH`. These are prerequisites, not
settings changes performed by the adapter. Resume uses the exact ID in the
shared session record for that repository and initiative.

**OpenCode**:

OpenCode 1.19.3 has a managed executor composed from the shared assignment,
authority, conduit, bubblewrap, supervision and result owners. The active native
qualification selector is `google-vertex/gemini-3.8-flash`, using the direct
`@ai-sdk/google-vertex` provider. The installed native catalog verifies `low`,
`medium`, and `high` variants, each setting `thinkingConfig.thinkingLevel`.
Its registered default effort is `medium`. The complete packaged orchestrator
profile is qualified at `medium` with opt-out publication disabled; the separate
interactive/start/resume fixtures select `low`. Other efforts refuse at family
preflight, without a downgrade.
[Google's model guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash)
also specifies these three levels and excludes `MINIMAL`. The existing native
Anthropic selector retains its separate five-variant registration. No OpenCode
model is selected implicitly. Main and auxiliary native requests are pinned to
the explicit model; the Codex/LiteLLM Gemini registration is separate and unchanged.

`google-vertex/gemini-4-argon` is also registered with default effort `medium`
and explicit `low`, `medium`, `high` variants. OpenCode 1.19.3
`models google-vertex --verbose` confirmed the exact ID, `@ai-sdk/google-vertex`
and matching `thinkingConfig.thinkingLevel` variants on 2026-10-19. Its provider
location is `global`; ordinary run argv and schema-session nativePrompt select
the exact requested model and variant. Main and auxiliary requests use that same
model. The opt-in `agent-launch.opencode.argon.vertex.medium.toml` selects medium
for all four roles with high-priority guides; `GOOGLE_APPLICATION_CREDENTIALS`
continues to point to the operator's existing private service-account leaf.
Current configuration and Flash defaults are unchanged. Catalog and model-free
fixtures establish registration and translation only: Argon native inference,
schema behavior and session qualification have not been demonstrated.

Native configuration can also be declared under `[opencode]` in the same
`agent-launch.toml` snapshot that selects role models. A provider explicitly
present under `opencode.provider` routes its `provider/model` selectors to
OpenCode without source registration, for role defaults and explicit model
overrides. OpenCode owns validation of providers, endpoints, model names,
authentication and native options. The launcher parses TOML and transports the
native subtree; it performs no discovery, endpoint preflight or model fallback.

For example, a complete local configuration for the four launcher roles is:

```toml
[roles.orchestrator]
model = "local/example-model"
high_priority_role_guide = true

[roles.worker]
model = "local/example-model"
high_priority_role_guide = true

[roles.reviewer]
model = "local/example-model"
high_priority_role_guide = true

[roles.redteam]
model = "local/example-model"
high_priority_role_guide = true

[opencode.provider.local]
npm = "@ai-sdk/openai-compatible"

[opencode.provider.local.options]
baseURL = "http://127.0.0.1:8000/v1"

[opencode.provider.local.models.example-model]
name = "Example local model"
```

`example-model` is illustrative: use the model ID served by the endpoint.
OpenCode launches share the parent's network namespace. `localhost` and
`127.0.0.1` refer to the launch environment, including any outer container;
they do not necessarily refer to the operator's physical host.

For a remote endpoint with native authentication, add a provider such as:

```toml
[opencode.provider.remote]
npm = "@ai-sdk/openai-compatible"

[opencode.provider.remote.options]
baseURL = "https://endpoint.example/v1"
apiKey = "replace-with-provider-key"

[opencode.provider.remote.options.headers]
X-Endpoint-Tenant = "example-tenant"

[opencode.provider.remote.models.remote-model]
name = "Example remote model"
```

Select `remote/remote-model` in the desired role tables, or use an explicit
orchestrator override. Authentication is optional when the endpoint permits it;
use native options appropriate to the endpoint. Additional nested provider,
model and option values retain their native names. For either example:

```sh
agent-launch orchestrator initiative
agent-launch orchestrator initiative --headless "finite task"
agent-launch orchestrator initiative --model remote/remote-model --effort high --headless "finite task"
agent-launch resume initiative --headless "finite continuation"
```

For explicitly configured providers, absent role/CLI effort leaves the native
variant unset. Requested neutral effort is passed as the native variant without
a model-support check; OpenCode rejects unsupported variants. The static Vertex
path keeps its registered default efforts, variant checks and exact credential
leaf binding. A configured custom provider neither reads nor binds an unrelated
`GOOGLE_APPLICATION_CREDENTIALS` file.

Interactive/headless start, exact-ID resume and managed roles carry the frozen
native subtree through the existing selection. Disposable checkouts need no
operator configuration. Both native `run` and `serve`/schema-session execution
use the existing private `OPENCODE_CONFIG`; authentication values are excluded
from public plan/session/debug JSON. The selected role model pins main and
auxiliary requests. Launcher-owned MCP registration, primary-agent instructions,
permissions, plugin disablement and isolation controls override competing native
settings. Ambient project/user/system configuration remains isolated. Native
configuration and provider failures use existing native error handling.

Deterministic forwarding and fixture-owned HTTP checks establish configuration
transport and schema request selection, including unregistered providers. They
do not qualify a live local or remote model, provider authentication or that
model's native tool/schema capabilities. No endpoint or model was supplied for
live qualification.

The operator launches an orchestrator; other
roles belong to MCP-managed dispatch, rather than public worker/review commands.

The decoder reads native JSONL `step_start`, `text`, `reasoning`, `tool_use`,
`step_finish`, and `error` events, preserving explicit native session identity.
Malformed/truncated streams, conflicting identities, native errors, denied
tools, and missing terminal completion cannot become clean review results.
JSON event formatting supplies no terminal-schema enforcement. An authentic
schema-constrained worker assignment refuses with
`opencode_native_schema_unavailable`, preserving its frozen mode. Ordinary
worker fenced mode and advisory free-prose mode come from the shared owner.

The registered factory supplies the existing closed managed conduit constructor.
Existing operator registries must explicitly contain `agents.opencode`; the
checked-in default registry supplies that entry, but existing settings are not
rewritten or supplemented implicitly.
If a workspace's `.agent-launch/launchers.v1.json` reports `Unknown agent in
launcher registry: opencode`, add this entry under its existing `agents` object,
preserving the other entries and `schema_version: 1`:

```json
"opencode": {
  "base_argv": ["opencode"],
  "noninteractive_argv": ["run", "--pure", "--format", "json"],
  "instruction_transport": { "kind": "argv_content" },
  "wrapper_arg": ["--", "{wrapper_content}"],
  "response_transport": { "kind": "stdout_capture" },
  "timeout_seconds": 60,
  "read_only": { "supported": false, "argv_suffix": [], "response_writable": true }
}
```

The registry's `read_only` field describes native flag support; managed advisory
confinement comes from the existing kernel and MCP owners.
Authentic ordinary workers retain fenced results; advisory reviewers/redteams
retain free prose. Scope, assignment, model/effort, selected guide and runtime
configuration failures are checked before acquiring the conduit or child.
Native provider errors retain their message and session ID, including on nonzero
exit. Native errors after apparent text cannot become successful output.

Gemini worker and reviewer fixtures complete authenticated native inference
through the existing confined executor with the explicit selector above and
`low` variant. Both perform successful `wiki_workspace_read_wiki` operations
over the launcher connector. The worker
reads its frozen assignment, reads an allowed file, edits two exact permitted
files and successfully calls `wiki_workspace_deliver_work`. Independent host
checks match the returned delivery commit to the slice ref, committed file
contents, exact changed paths, retained attempt-journal receipt and canonical
slice review status. The native filesystem probe records `ENOENT` for the
ungranted sibling read and `EROFS` for its attempted write; the sibling remains
unchanged in both the checkout and delivery commit.
The reviewer reads its record and permitted file, receives `EROFS` for an
attempted repository write, leaves the fixture files unchanged and returns
free prose. These are disposable behavioral fixtures, not production coordinator
settlement or repository review passes. Native session identities are captured
from the versioned event stream.

The shared `get_run_result` declaration remains in worker/reviewer profiles.
Its equivalent object-root projection and the boolean-literal projection have
been accepted by the installed Google Vertex SDK/provider on those surfaces.
The common registrar applies the existing boolean-literal projection once,
after each tool's optional native publication projection. This includes tools
registered outside the task family, such as `query_code_index` and
`workspace_run_test`. Boolean type and literal meaning are preserved through
negation; repeated simple constraints share local references, with types inline.
Served and retained declarations use the same cached final result. The installed
16-tool paid CCE orchestrator profile demonstrates declaration agreement and
strict rejection of `query_code_index` status `false` and string `"true"`;
`status:true` executes successfully. Validators, handlers, grants and tool
availability remain unchanged. No family-local rewrite or tool removal is used.

The complete packaged OpenCode 1.19.3 / Vertex Gemini 3.8 Flash `medium`
orchestrator fixture demonstrates actual native Read, Edit, Glob and Grep,
including the selected guide/vignette pair, a retained MCP response and a
managed-worktree file. Both `query_code_index({status:true})` and
`workspace_read_wiki` execute through the full 16-tool MCP profile. Required
operations complete without permission prompts. This fixture performs no worker
dispatch, review or benchmark. It retains the installed inventory, package
identity, native events and outcome separately from deterministic checks.

OpenCode now serializes existing launcher grants through
`workspace-agent-native-permission-facts.mjs`: shared role/write policy, frozen
worker membership, selected guide grants, exact conduit tool names and
launcher-owned support roots. Worker reads include writable members; native
edits stay within frozen writable membership, and findings roles receive none.
Orchestrator commands are denied and edits stay within coordination roots.
OpenCode's external-directory traversal rules and relative read/edit rules are
both explicit. Unlisted tools are denied; secrets and private contract paths
retain their exclusions. Native wildcard characters in literal grant paths
refuse rather than broaden the grant. Claude and Codex retain their existing
native configuration implementations.

Every start/resume gets fresh permission configuration. Resume refuses persisted
session allow rules because OpenCode merges them after its agent permissions;
those rules cannot override current launcher grants. The shared sandbox forwards
the captured opt-out publication setting and mounts the exact response root
read-only. Native search requires preinstalled ripgrep on an approved runtime
path; preflight refuses its absence before model execution, and the prepared
image installs it during construction. No runtime download is required.
The complete declaration budget check also exposes existing overruns:
`workspace_read_wiki` is 4,242 bytes and `workspace_run_test` is 6,266 bytes,
each against 4,096. These same sizes occur in the retained failed benchmark
inventory. Their publication owners need separate repair; budgets are unchanged.
Schema-constrained OpenCode workers, Gemini native redteam behavior and full
benchmark success remain unqualified.

OpenCode's sparse read-boundary registration is backed by a physical shell
witness through the actual executor's kernel plan: an allowed file was read,
an exact writable file was edited, an ungranted sibling could neither be read
nor written, and the native configuration stayed read-only. That fixture also
retrieved its assignment through authenticated wiki MCP and was denied an
unregistered tool. These kernel/conduit checks supplement the native worker
edit and delivery evidence above. Coordinator-managed production launch and
settlement remain unverified; disposable-fixture qualification does not
establish them.
Separate executor-backed kernel witnesses also denied repository writes and
the delivery tool for reviewer and redteam sessions. Both routine advisory
tests retain `free_prose` despite a conflicting raw schema-mode hint.

Each attempt receives private HOME and XDG state/cache/data directories under
the existing external launcher runtime-state owner, plus a separate read-only
native configuration directory. Native state is retained there; it is not
stored in the conduit's transport directory or used for implicit resume.
The existing service-account credential is mounted as one read-only leaf and
selected through the chosen native provider's `googleAuthOptions.keyFilename`,
with its project from the credential and location `global`. Gemini configuration
uses `google-vertex`, rather than `google-vertex-anthropic`. Shared
environment filtering still removes `GOOGLE_APPLICATION_CREDENTIALS` and
excludes ambient OpenCode configuration/permission overrides. Project config
discovery is disabled, plugins are disabled with `--pure`, and an existing
`/etc/opencode` directory is masked through the shared managed-family builder.
Operator fixtures inject competing project/user/managed configuration without
changing operator or system files. Native configuration inspection confirms the
complete host-selected guide, declared model/effort and wiki-only registration;
authenticated headless start/resume succeeds with the managed competitor present
in a disposable mount namespace.

Native agent-prompt delivery requires the resolved high-priority guide option;
lower-priority guide delivery refuses with
`opencode_native_guide_delivery_unavailable`. The complete selected guide is
referenced by the native agent prompt. Retention through native compaction and
clear remains unverified. No granular native permission settings or `--auto`
bypass are added; permissions rely on the existing kernel and MCP owners.

OpenCode operator start and exact-session resume use the registered shared
orchestrator route. Declare the native model and effort explicitly:

```sh
agent-launch orchestrator initiative --model google-vertex/gemini-3.8-flash --effort low
agent-launch orchestrator initiative --model google-vertex/gemini-3.8-flash --effort low --headless --log-file /absolute/operator.log "finite task"
agent-launch resume initiative --model google-vertex/gemini-3.8-flash --effort low --headless "finite continuation"
```

The selected orchestrator role must enable `high_priority_role_guide` in its
existing launcher configuration. The host-selected guide and tier feed the
native primary agent prompt. Interactive mode uses the native TUI and inherited
controlling terminal; headless mode uses native JSONL and the shared log target.
Explicit `low` overrides the registry's `medium`; interactive effort is pinned
in the agent's native `model`/`variant` configuration because this installed TUI
has no `--variant` flag. Headless also receives `--variant low`. Both main and
auxiliary native model selectors stay pinned to the declared model.

The launcher session owner retains `session.json` under the external per-workspace
runtime root's `opencode-orchestrator/<initiative>` directory. Each fresh start
has a separate private native state directory. After native exit, the adapter
reads only that private OpenCode 1.19.3 database and requires exactly one
repository-bound root session. Headless event identity must agree with it.
The shared session record carries the observed native ID, retained state root,
last native message ID, model/effort, host guide/tier and invocation's conduit ID.

Resume validates the same repository, initiative, family and unchanged native
message boundary before allocating transport. It passes the exact recorded ID
with `--session`, retains that native state, and creates a fresh conduit and
immutable configuration with re-delivered instructions. There is no global
session scan or latest-session selection. Missing, ambiguous, mismatched and
stale identity refuses before native spawn. Native schema enforcement remains
unsupported for schema-constrained workers.

Authenticated disposable fixtures demonstrate headless start, native interactive
PTY start with orderly exit, and continuations from both kinds of captured
session using `google-vertex/gemini-3.8-flash`, effort `low`, with successful
wiki-MCP reads. Guide retention across native compaction/clear and downstream
production coordinator dispatch/settlement remain unverified. These entrypoint
checks do not establish those capabilities.

Native completion facts use an optional semantic hook in the shared orchestrator
supervisor, separate from best-effort usage accounting. Native errors at process
exit zero, malformed/incomplete streams and conflicting session identity fail;
the shared owner derives terminal status, persists identity and handles conduit
cleanup. Other families omit this hook and keep their existing behavior.
Dry-run validates and projects the command, effort, posture, guide and runtime
paths without allocating native state, transport, logs or session records.

Shared supervision binds exit and error observation synchronously after spawn,
before usage-pointer retention or running-state persistence. It retains terminal
facts without an early rejected promise, so a fast exit is observed even while
bookkeeping is pending, and asynchronous spawn failure needs no exit event to
settle. Bookkeeping rejection retains its original diagnostic and abandons the
wait; a still-live child's error guard remains through caller-owned cleanup and
is removed on close. Terminal/session persistence, native completion and conduit
cleanup keep their existing owners. Deterministic deferred-write tests cover
zero/nonzero exits, signal termination, asynchronous spawn error and bookkeeping
failure, with bounded real-child checks and listener cleanup assertions.

### State-class summary

| Family | operator-owned source | launcher-owned per-run | writable runtime state | result source |
| --- | --- | --- | --- | --- |
| Codex | `CODEX_SOURCE_HOME` (`~/.codex`) entries symlinked read-through | private `CODEX_HOME` = `<runtime-base>/codex-home` (`log`/`sessions`/`tmp`/`shell_snapshots`/`rules`, `final.md`) | per-run dirs inside the private `CODEX_HOME` | `finalPath` (`--output-last-message`) |
| Claude | `~/.claude/.credentials.json`, `~/.local/share/claude` (host-home-derived) | run dir (stdout capture) | OAuth credential leaf writable for normal implementation workers; read-only for exact findings roles | `stdout` |
| Agy | read-only OAuth token leaf; interactive onboarding booleans | immutable private home and MCP config | retained native conversation/cache/project root | native stream JSON or exact private SQLite conversation facts |
| OpenCode | explicit native selector; exact read-only credential leaf | private native config and HOME/XDG roots | private native session/cache/database state under launcher runtime root | native JSONL or invocation-private database facts; Gemini worker delivery, read-only role, operator TUI/headless and exact-session continuations demonstrated in confined fixtures |

In this table `~` / `$HOME` denotes the launcher-owned operator host home that
the launcher discovers from trusted host facts (macOS `/Users/<user>`, Linux
`/home/<user>`); it is platform-neutral explanatory notation, not a fixed
`/home/user` path and not an agent-provided `HOME`/`XDG`/`PATH` value. The
launcher derives the runtime leaves above from that host home and does not mount
the broad host home or credential/config parents.

### Codex source-home assumptions

The Codex source home is resolved from `CODEX_SOURCE_HOME` (when set and
non-empty) or `~/.codex`. The symlinked name-set above is hardcoded and
**unvalidated**: a non-default Codex install that does not present those exact
names under the source home gets a private `CODEX_HOME` missing the
corresponding symlink, with no structured setup blocker. A stable
setup-blocker for non-default installs (validating the expected source-home
name-set and refusing with a structured diagnostic) is **not** implemented by
this docs/tests slice and must be split into a code slice after the
`codex-role.mjs` seam extraction — docs and tests alone do not implement it.

### Forbidden-token naming constraint

Do not introduce structured launch fields (launch-plan keys, work-record
fields, or run-status fields) whose names contain the literal `CODEX_HOME` or
`codex_home_overlay`. Those tokens can trip forbidden-token scans tied to the
removed prelude overlay. Documenting the env var `CODEX_HOME` in prose
(as above) is fine; minting a JSON field named after it is not.

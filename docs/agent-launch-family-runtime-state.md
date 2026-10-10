
# Per-Family Launcher Runtime State

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents the runtime-state facts for the supported Codex and Claude
families, the four runtime-state classes used to describe them, and the explicit
fail-closed Agy posture. The launcher lifecycle is converged; supported-family
runtime state remains family-specific.

## Family Runtime State

The launcher **lifecycle** is converged — one shared
`superviseChildLaunch` child supervision / bounded capture / final-result path
used by supported families on the launcher-owned in-process path.
Runtime state is **not** converged. Codex's private `CODEX_HOME` and Claude's
credential/config mount are app-specific runtime facts, not a shared runtime-state
implementation. Agy has no supported confined executor or registration adapter;
the shared interface refuses it before launch and does not provision Gemini state.

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

Agy is unsupported for confined worker, reviewer, redteam, and orchestrator
launches. Selection fails closed before model spawn. The launcher creates no
wiki-MCP transport, repository write bind, Gemini credential/config bind, broad
`~/.gemini` writable state, or result-capture lifecycle for Agy. Future support
must reuse the same host-server and local socket conduit interface; it cannot add a
second transport.

### State-class summary

| Family | operator-owned source | launcher-owned per-run | writable runtime state | result source |
| --- | --- | --- | --- | --- |
| Codex | `CODEX_SOURCE_HOME` (`~/.codex`) entries symlinked read-through | private `CODEX_HOME` = `<runtime-base>/codex-home` (`log`/`sessions`/`tmp`/`shell_snapshots`/`rules`, `final.md`) | per-run dirs inside the private `CODEX_HOME` | `finalPath` (`--output-last-message`) |
| Claude | `~/.claude/.credentials.json`, `~/.local/share/claude` (host-home-derived) | run dir (stdout capture) | OAuth credential leaf writable for normal implementation workers; read-only for exact findings roles | `stdout` |
| Agy | unsupported | none | none | none; launch fails closed |

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

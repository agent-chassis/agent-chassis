# Agent-launch confinement and MCP conduit

Confined implementation and findings roles use bubblewrap to keep repository
visibility and mutation within declared role scope. This is the scope mechanism
described by the
[no-additional-security-profile doctrine](operating-model.md#scope-doctrine-no-additional-security-profile),
not a security profile or task-safety boundary. For a managed worker, the visible
repository namespace is exactly the frozen union of canonical `read_scope`,
`repo_paths`, and `write_scope`; mutation is possible exactly within
`write_scope`, with the controlled-contract private family at
`wiki/contracts` subtracted. A full host checkout never broadens this namespace.

Every confined worker, reviewer, redteam, and orchestrator launch (including
orchestrator resume) also receives one launcher
support directory outside that scope: the `data/role-guides/` directory of the
launcher's own `@agent-chassis/agent-launch-core` package, resolved from that
package in source and installed layouts alike. The shared planner grants it from
the trusted launch role, never from task scope, sparse authority, prompt text,
environment, or the candidate checkout. It hard-binds that directory read-only
at its resolved absolute path after every writable mount and before the final
confidentiality masks, so every shipped guide is readable and none is writable.
The role's selected guide (`managed-worker.md` for a worker, `reviewer.md` for a
reviewer or redteam, `orchestrator.md` for an orchestrator) also keeps its exact
read-only bind and its identity pin
from the required-file check; a missing, unreadable, non-regular, or changed
selected guide refuses the launch. For a worker, reviewer, or redteam, Claude's
minted native permission settings allow `Read` for the same resolved directory
subtree, and grant no edit there.

## Related pages

This page owns agent-session confinement, the role guide grant, Git metadata
projection and the normative session contract. Related mechanisms are split by
topic:

| Page | Owns |
| --- | --- |
| [Git status under the private-family overlay](agent-launch-git-status-interception.md) | The orchestrator `git status` interception, its entrypoints, mounts and refusals. |
| [MCP conduit lifecycle](agent-launch-mcp-conduit-lifecycle.md) | The socket transport and admission, lifecycle protocol generation, readiness phases, teardown, failure reporting and client registrations. |
| [Conduit authority and review sources](agent-launch-conduit-authority-and-review-sources.md) | The minted conduit authority, the frozen findings contract, review checkout capture, entry material, the frozen worker assignment and terminal candidate validation. |
| [Worker test runtimes](agent-launch-worker-test-runtimes.md) | The read-only toolchain and dependency projection for a managed worker's own commands. |
| [Conduit capture and probes](agent-launch-conduit-capture-and-probes.md) | Optional transcript capture, the metrics destination and the confined-worker probe composition. |
| [Test-proof execution](test-proof-execution.md) | Host test and proof execution, which is not session confinement. |

## Role guide after compaction

A confined Claude or Codex session gets its selected guide back after the client
compacts the conversation, manually or automatically. The launcher adds one
synchronous `SessionStart` hook whose matcher is `^compact$`, so a plain
startup, resume, or clear does not run it. The hook is one shell command line
built by the shared hook owner for both clients. It reads that one package file
with `/bin/cat -- '<selected guide path>'` inside the session's namespace when
the hook runs, and the client adds the output to the context before its next
model request. Nothing is copied, cached, or linked, and the working directory,
the task, and the hook input select nothing.

The guide comes back as a reminder, not as new authority. The command prints
this introduction, then the complete guide, unchanged, between a `<role-guide>`
line and a `</role-guide>` line:

> Role reminder: the following is your role guide. Use it to remember your role
> and relevant working guidance. Explicit operator instructions and repository
> policy take precedence over this guide, including its mandatory wording. This
> reminder grants no additional tool or filesystem permissions.

The command uses only `/bin/cat` and shell built-ins, and reads the whole guide
before it prints anything, so the introduction never arrives without the guide.

- **Codex** receives the hook as two `-c` overrides in the confined child's
  argv only: `hooks.SessionStart` with the one handler (its
  `additionalContextLimit` is `0`, so the guide is never replaced by a preview),
  and `hooks.state` with one entry that enables that handler and trusts its
  exact hash under the key `/<session-flags>/config.toml:session_start:0:0`.
  The hash follows Codex 0.160.1's normalized hook identity. No other hook
  source, hook state, or trust setting is read or changed: a user, project, or
  plugin hook the operator has not trusted stays untrusted and does not run.
  Managed requirements keep their authority; under a managed-hooks-only policy
  Codex does not run this hook.
- **Claude** receives the hook in the launcher-minted settings file. A managed
  worker, reviewer, or redteam, and a headless orchestrator, launch with a
  confined settings file holding the same permissions plus the hook. An
  interactive orchestrator launch or resume, which has no permission settings,
  launches with a settings file holding only the hook.

The hook follows actual confinement. An operator direct-mode orchestrator and an
unenforced plain launch get no hook and no hook-related refusal. A hook that
cannot be composed refuses the confined launch before spawn and names the guide,
the cause, and the operator repair. At run time a failed read exits nonzero with
`/bin/cat: <file>: <cause>` on standard error and adds nothing to the context,
not even the introduction.
Neither client blocks a session on a failed `SessionStart` hook: the session
continues without the guide. Codex reports the hook as `Failed`; Claude's hook
event carries the nonzero exit and that standard-error line. Claude caps
one hook's output at 10,000 characters; each shipped role guide with its
introduction and delimiters is smaller.
The grant exposes no containing package directory, package file, or repository
content, and it is neither `read_scope` nor write authority.

## Enforced and unenforced launches

The subtraction is a filesystem fact only after an enforced bwrap plan is
constructed and spawned. The launcher derives the private path itself, overlays
it with an empty read-only mount after every ordinary read/write mount, and
refuses before spawn if an already-visible private subtree is not a canonical
directory or the boundary cannot be built. Sparse projections do not add
visibility merely to mask an already-absent path. Wide projections—including
confined reviewer, redteam, orchestrator, and operator postures—receive the same
final overlay. Prompt text, role names, scope policy facts, and an unavailable
backend are not filesystem enforcement.

Direct and supported plain-spawn modes do not apply this confinement. Their
plan/runtime output states `enforced=false`, `isolation_backend=none`,
`filesystem_confidentiality_guaranteed=false`, and
`private_repository_path_enforced=false`, stating that the corresponding
filesystem mechanisms are absent. The compatibility field name does not turn an
enforced run into a broader confidentiality guarantee. Those modes remain
available where decision or decision permits them;
they are neither blocked merely because the private family exists nor described
as confined.

## Git metadata and source selection

Advisory reviewer and redteam launches and terminal candidate validation receive
the installed Git executable through the ordinary system-runtime projection and a
required, launcher-authenticated, read-only Git administration projection. The
authenticated owner selects it: the launcher-owned advisory review input for Codex
and Claude reviewer/redteam launches, and the authenticated terminal candidate for
terminal validation. The shared resolver in
`launch-isolation-findings-git-metadata.mjs` derives the projection from the
launcher-created linked checkout itself: the root `.git` indirection, selected
worktree gitdir, common Git directory, primary object directory, and configured
object alternates. It requires the common Git directory to belong to the
authenticated repository and the selected worktree `HEAD` to name the authenticated
reviewed commit. It pins exact non-symlink identities, including that `HEAD` file,
through spawn and constructs an empty namespace skeleton containing only the
selected worktree gitdir, object stores, refs, and required singleton Git files.
The mutable common `.git` directory and unrelated worktree administration are never
bound. The planner revalidates a supplied projection against a fresh
checkout-derived resolution, and each launch path confirms the projection survived
into the exact plan it spawns. Missing, malformed, substituted, changed, or dropped
Git metadata refuses before spawn with the typed
`findings_git_metadata_invalid` or `findings_git_metadata_changed_before_spawn`
diagnostic and the `mechanical_failure` authority limb. A repository object store
exposes every tracked path, so the planner refuses to combine it with a sparse
declared read scope. These mounts accept no caller-selected Git environment, path,
ref, object directory, or identity, and add no write authority. Codex reviewer and
redteam launches inspect the projection through their command tool; Claude reviewer
and redteam launches receive `Bash` under the minted native-permission settings,
which deny native edit tools, so both findings roles can run read-only Git commands.

Implementation workers receive no Git administration or object-store mounts. For a
provisioned managed worker the launcher still authenticates the server-supplied
worktree binding against the checkout-derived topology, but projects none of those
paths into the worker namespace. Workers keep their family command tool (Codex
`exec_command`, Claude `Bash`) inside that namespace, so commands can edit only
`write_scope` through the bwrap write binds and see no Git storage. Workers keep
their launcher MCP capabilities and rely on host-owned validation and delivery,
which use Git outside the worker namespace.

Source selection is normalized before confinement composition. Canonical slice,
terminal whole-WK, and explicit `reviewed_sha`/`diff_base_sha` selectors converge
on one repository/base/reviewed/tree target. An explicit pair selects immutable
review bytes without becoming an authority carrier. The resolver proves commit
objects, ancestry, the required nonempty range, readable tree, and exact private
snapshot; canonical selectors additionally prove their subject binding.
Confinement consumes that normalized result and does not reinterpret it. Caller
Git environment, paths, refs, or mutation claims remain forbidden.

## Launcher agent session contract (normative)

This section is the sole normative specification of
`launcher-agent-session-contract.v1`. The carrier is an authenticated,
deterministic projection of the branded
`launcher-stdio-mcp-conduit-authority.v1` owned by
`stdio-mcp-conduit-authority.mjs`; it is not another authority or policy engine.

### Closed schema and field semantics

The top-level JSON object contains exactly these twelve keys, with no unknown,
duplicate, missing, or role-forbidden fields: `schema_version`, `role`,
`assigned_unit`, `repository`, `read_scope`, `repo_paths`, `write_scope`,
`lifecycle`, `capabilities`, `completion_transport`, `minting_provenance`, and
`contract_digest`.

- `schema_version` is exactly `launcher-agent-session-contract.v1`.
- `role` is exactly `orchestrator`, `worker`, `reviewer`, or `redteam`.
- `assigned_unit` is closed at `record_id`, nullable `slice_id`, and canonical
  `address`. Orchestrator sessions accept exactly `IN-[0-9]{4}`, copy that
  address to `record_id`, and require `slice_id: null`. Worker, reviewer, and
  redteam sessions accept exactly `WK-[0-9]{4}` or
  `WK-[0-9]{4}#SLICE-[0-9]{3}`; their `record_id` is the WK address and their
  `slice_id` is null or the exact `SLICE-[0-9]{3}` suffix. Partial matches,
  whitespace, arbitrary suffixes, and cross-role initiative/WK addresses
  refuse. `repository` is closed at launcher-resolved, repo-qualified
  `repository_id`.
- `read_scope`, `repo_paths`, and `write_scope` remain distinct. Each is a
  duplicate-free, bytewise-sorted array of normalized repository-relative
  selectors.
- `lifecycle` is closed at `position` and nullable `review_purpose`.
  `review_purpose` is `standalone` or `terminal_whole_wk` for reviewer/redteam
  and null for orchestrator/worker.
- `capabilities` is a duplicate-free bytewise-sorted population of stable
  identifiers proven present in the launcher capability-registry snapshot.
- `completion_transport` is closed at `transport_id`, exactly one of
  `coordinator_control`, `managed_slice_delivery`,
  `workspace_submit_for_review`, or `standalone_findings`, consistent with the
  resolved role/runtime route.

### Canonical serialization and digest

Canonical serialization is UTF-8 JSON with recursively bytewise-sorted object
keys, no insignificant whitespace, normalized scope/capability/source-binding
arrays, and no Unicode or numeric coercion. `contract_digest` is
`sha256:<lowercase-hex>` over the canonical bytes of the entire closed object
with `contract_digest` omitted. Every consumer recomputes it before using a
field.

### Minting provenance and decision

`minting_provenance` is closed at `issuer`, `authority_schema_version`,
`authority_digest`, `capability_registry_digest`, `trusted_source_bindings`, and
nullable `operator_action_binding`. `trusted_source_bindings` is the complete
bytewise-sorted population of closed `kind`/`id`/`digest` tuples.

Two bindings are required and appear exactly once each. Every contract carries
the `stdio_mcp_conduit_authority` binding of its minting authority. A contract
minted for an advisory findings launch also carries one `advisory_review_source`
binding whose `id` is the advisory `run_id` and whose `digest` commits to the
five closed facts `role`, `assigned_unit`, `run_id`, `repository_root` and
`materialization_root`. The materialization root is the private checkout the
launcher captured the review into (see
[launch and admission](mcp-dispatch-launch-and-admission.md)); that bound
checkout is the review source, and no other artifact or environment variable
names it. Launcher and host compute the binding digest through one
normalization owner: each root is the real path of an existing root, so a
symlinked root and its target agree while a retargeted link does not. A
caller-supplied binding list may add other sources but may not remove,
substitute, or duplicate a required binding, and may not add a review source to
an authority that carries none. Two independent reviews of the same source are
different runs and therefore carry different source bindings and contract
digests.

`operator_action_binding` is null unless a separately authenticated accepted
action applies. Its decision form is closed at `decision_id` (exactly
`decision`), `action_id`, `authenticated_actor_binding_digest`,
`selected_findings_source_digest`, and `action_binding_digest`, which binds the
other four fields. Raw requests, prompts, argv, ambient environment, wrappers,
AGENTS.md, and filesystem bytes never mint or widen a contract fact.

### Consumers, compatibility, and coherent cutover

Codex and Claude consume one family-neutral carrier for all four roles. Each
family admission seam recomputes the digest and compares every resolved fact
before readiness. Host wiki-MCP authenticates the exact launcher-startup carrier
against launcher facts. Prompt prose is presentation derived only after
validation. Monitoring exposes a bounded read-only projection with the same
`contract_digest` and never mints, repairs, or widens the carrier.

The cutover is coherent and v1-only. Producers emit only
`launcher-agent-session-contract.v1`; Codex, Claude, host wiki-MCP, prompt, and
monitor consumers accept only v1. The former partial completion credential is
rejected as unsupported and is never translated, dual-read, or reconstructed
from prose.

### Stable refusal contract

Every failure occurs before child or host readiness in the existing closed
`stdio_mcp_conduit_input_invalid` envelope, with exactly one of these ten codes:

- `session_contract_missing`
- `session_contract_schema_unsupported`
- `session_contract_shape_invalid`
- `session_contract_authority_untrusted`
- `session_contract_fact_mismatch`
- `session_contract_digest_mismatch`
- `session_contract_capability_unknown`
- `session_contract_completion_transport_mismatch`
- `session_contract_operator_action_binding_invalid`
- `session_contract_consumer_version_mismatch`

No completion credential, AGENTS.md, prompt, environment, argv, wrapper, prose,
or monitoring fallback repairs a refusal.

### Supported compatibility census

The exact supported population is 24 combinations: four roles multiplied by
Codex/Claude multiplied by AGENTS.md present/empty/absent. For equal launcher
facts, each role/family three-state group has byte-identical complete carrier
bytes and digest. AGENTS.md may affect only human-reference metadata outside the
carrier and digest. Unsupported role/family/state combinations refuse.

### Contract owners

Three owners, and no others, hold any part of this contract:

- `workspace-agent-role-contract.mjs` is the sole semantic route classifier.
  `classifyLauncherFindingsCompletionTransport` decides a route's completion
  transport from the launcher-minted `canonicalRepo` signal and the role.
  Nothing else may spell a transport out or grow a parallel predicate.
- `stdio-mcp-conduit-authority.mjs` is the sole minter, authenticator, and
  refusal owner. `mintLauncherAgentSessionContract` is the only way a contract
  comes into existence, and `authenticateLauncherAgentSessionContract` is the
  only thing that validates a transported one against launcher-resolved expected
  facts or the launcher-expected contract. The conduit core's
  `mintStdioMcpCompletionCredential` and
  `authenticateStdioMcpCompletionCredential` delegate to those two, and the
  wiki-MCP server's `launcher-run-credential.mjs` authenticates through the same
  owner, so no consumer reaches the injectable conduit core. Minting and
  authentication are distinct operations: aliasing authentication to minting
  would re-derive every check from facts already trusted and validate nothing.
- The Claude and Codex family modules are mechanical consumers. They select
  which expected facts their route completes against, forward the carrier, and
  project the authenticated result's own fields into the conduit input. They
  hold no field inventory, no mismatch classifier, no refusal-envelope
  constructor, and no call to the minter. A source scan in
  `tests/integration/workspace-agent-family-adapter-boundary.test.mjs` fails on
  any of these reappearing in a family-named module.

The conduit input is a closed carrier set that accepts the resolved facts
(`completionTransport`, `canonicalRepo`) and never a caller-built contract
object. The child cannot mint or replace the carrier from prompt, caller, or
ambient environment.

### Historical completion credential (retired)

Before the coherent session-contract cutover, findings-role launches carried
`launcher-stdio-mcp-completion-credential.v2`, a five-field envelope
(`schema_version`, `completion_transport`, `canonical_repository`,
`assigned_unit` and the launcher-derived `technical_role`) with its own
`mismatch_class` refusals. It is retired. No producer emits it, no consumer
accepts, upgrades, repairs or infers it, and the session contract above with its
ten refusal codes is the only carrier.

## Test and proof execution is a separate host capability

`workspace_run_test` and `verify_proof` do not run test code inside the invoking
agent's namespace. Under `decision` (repository-only:
`wiki/decisions/decision.md`) a confined role whose profile grants the tool
calls it over the conduit, the host wiki-MCP server authenticates the source and
assignment, and the launcher starts the test processes on the host with the host
user's permissions: no bubblewrap, replacement sandbox, read-only mount, secret
mask or network denial applies to them. Test code can therefore reach Git
metadata, accepted decisions, dependencies and the network even when the calling
session cannot.

Agent-session confinement is unchanged by this. A run adds no mount, write
scope, tool grant or visibility to the session, and the request names no
command, argument, environment variable or path. Session isolation must never be
presented as end-to-end confinement of test execution; the
[enforcement model](enforcement-model.md) reports the two separately.

[Test-proof runtime identity](test-proof-execution.md#shared-test-execution)
owns the shared test and proof semantics, and this page does not restate them:
[host execution](test-proof-execution.md#host-execution) (execution root,
curated environment, driver framing, budget, settlement and cleanup reporting),
[transformed proof copies](test-proof-execution.md#transformed-proof-copies),
[provider families](test-proof-runtime-identity.md#native-provider-families),
routing, compiler caches and the observation protocol. The `workspace_run_test`
route is in [Ordinary test runs](local-test-runtime-setup.md#ordinary-test-runs).

Three confinements remain separate from that capability and from each other:
agent sessions (this page and its related pages); the worker's own `node`,
`python3`, `go`, `cargo` and `deno` commands, which run inside its sparse
namespace with the read-only projection in
[Worker test runtimes](agent-launch-worker-test-runtimes.md); and local test-runtime
setup's verification probes, which run through the validation confinement
planner with a read-only checkout, read-only dependency locations, a private
temporary mount, masked `.agent-launch` state and no network. A setup probe's
npm project copy is Git-selected and distinct from a proof copy (see
[Verification and readiness](local-test-runtime-setup.md#verification-and-readiness)).

## LiteLLM-routed Codex launches

A Codex launch whose selected model is LiteLLM-routed (see
[env reference](env-reference.md#per-model-litellm-routing-modelsid-vertexai))
keeps its role's confinement, mounts and secret-environment policy unchanged.
The route adds only argv, one file and one proxy-bypass entry:

- `-c model_provider="agent_launch_litellm"` and an inline
  `model_providers.agent_launch_litellm` table are inserted before the final
  positional by the shared Codex renderer, with `-c web_search="disabled"`: a
  Vertex partner model would otherwise receive Codex's hosted web-search tool
  as a provider feature (refused where Vertex organization policy does not
  allow it). `-c` outranks an inherited profile provider and a same-named user
  provider table.
- The provider table sets `stream_max_retries=5`, so Codex re-sends a request
  whose stream failed up to five times (six attempts in all) whatever the
  installed CLI's default is. The gateway itself does not retry.
- The provider authenticates with Codex's command-backed auth: `/usr/bin/cat`
  (inside the read-only system roots) reading one exact per-run key file. The
  file is created 0600 in the role's existing launcher runtime directory
  (`CODEX_HOME/tmp` for headless roles, the orchestrator runtime directory
  otherwise), which the namespace already binds. No key enters the child
  environment, so the `OPENAI_API_KEY`-style `--setenv` denial is not relaxed.
- The attachment happens only on a real launch, after the launch's own
  refusals (plan, isolation, MCP conduit, sandbox fail-open decision) have been
  decided and immediately before the spawned argv is materialized, so a refused
  launch never provisions, starts or contacts the gateway. The key file is removed when the
  child exits, or immediately when the launch is refused before spawn. The
  shared gateway and its key are never stopped or removed by a launch.
- The endpoint is loopback, so the confined child reaches it through the shared
  network namespace Codex roles already use.
- The routed client's environment gains the gateway address in its proxy bypass
  list, so it reaches the gateway without the caller's proxy (the exact rule is
  in [Proxy environment](env-reference.md#proxy-environment)). The attachment
  replaces the client's environment with a new one; the caller's environment,
  the host wiki-MCP server's and the gateway's are not changed, and the
  confined plan and an unconfined fallback spawn both use the client's.

A gateway failure refuses the launch with the gateway's own code (for example
`litellm_gateway_foreign_listener` or `litellm_runtime_install_failed`), its
stage, correction and bounded detail. Diagnostics never include gateway log
content, key bytes or Google tokens; they name the log path instead.

## Proxy environment through the launch chain

The caller's standard proxy variables are routing configuration, and the
launcher carries them unchanged through every local launch boundary (the eight
names and the exact forwarding rule are in
[Proxy environment](env-reference.md#proxy-environment)):

- The closed environment policy for confined children does not deny them. An
  orchestrator, which launches under the deny policy alone, keeps them; the
  Codex and Claude role allowlists both name them, from one shared list.
- The host wiki-MCP server is started with the proxy variables of the launcher
  process that mints its conduit, alongside that process's `PATH` and `HOME`.
  The roles it dispatches inherit them from the host server through their own
  allowlist.
- The host wiki-MCP server is also started with `NODE_USE_ENV_PROXY=1` unless
  the launcher process sets that variable itself, in which case its value is
  passed on unchanged (including `0` and an empty value). Node's built-in
  `fetch`, which the host server uses for its own requests, follows the proxy
  variables only when this is enabled. It is set for the host server process
  alone: no role allowlist names it, so dispatched roles and orchestrator
  sessions do not receive it.
- LiteLLM runtime setup and the shared gateway receive the same projection.

Everything else about a launch is unchanged: `NODE_OPTIONS`, `NODE_PATH`,
secret-named and posture variables are still denied, an allowlist still cannot
re-admit a denied name, and namespaces, mounts, role boundaries and whether a
launch is permitted do not depend on any proxy value. Forwarding is not an
egress boundary: it does not limit what a launched process can reach.

## Dependency location and toolchain selection environment for the host server

The host wiki-MCP server locates installed test dependencies for the test runs,
proof attempts and worker test runtimes it serves, and selects toolchains for
its code index, so it is started with the variables the launcher process's own
tools read to do the same:

| Read by | Variables |
| --- | --- |
| Deno dependency location | `DENO_DIR`, `XDG_CACHE_HOME` |
| Go module location | `GOMODCACHE`, `GOPATH`, `GOENV`, `XDG_CONFIG_HOME` |
| Cargo dependency location | `CARGO_HOME` |
| Code index Rust toolchain selection (the rustup proxy on `PATH`) | `RUSTUP_HOME`, `RUSTUP_TOOLCHAIN` |
| Code index Go toolchain selection (the `PATH` `go`) | `GOTOOLCHAIN` |

One policy names them
(`packages/agent-launch-cli/src/lib/test-runtime-setup/location-environment.mjs`):
dependency detection reads the location variables through it and nothing else,
and the host server receives the whole projection of the launcher process that
mints its conduit, alongside that process's `PATH` and `HOME`. The selection
variables are read by the code index alone; a test runtime runs the saved
executable, else the `PATH` one, as itself. A selection that names something
not installed is the selecting tool's own failure in the host server: the
project is refused (`scip_rust_toolchain_unavailable`,
`scip_go_toolchain_unavailable`), no other installation is chosen and nothing
is downloaded. A host server that mints
conduits for the roles it dispatches passes them on the same way. A value is
passed on exactly as supplied, an empty value stays empty, and a variable the
launcher does not have stays absent, so the tool's own default applies. npm and
Python take no such variable: a module tree is found from the project directory,
and a virtual environment is the saved selection or the nearest one.

Nothing else is added to the host server's environment, and the confined
children's allowlists are unchanged. A saved runtime configuration and a
published preparation keep their precedence over what detection would locate,
and a command still runs with the location the runtime binding names, never
with the launcher's variable itself.

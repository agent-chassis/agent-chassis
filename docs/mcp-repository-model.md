
# MCP Agent-Facing Repository Model

This page is the agent retrieval model for `agent-chassis` MCP: which repository a server works on, who owns the bytes a read returns, how large answers are delivered, how host processes are isolated, and how code-index questions are answered. The operations themselves are listed once, in [MCP Operation Reference](mcp-operation-reference.md); start with [MCP integration](mcp-integration.md) for setup and the workflow narrative.

## Agent-Facing Repository Model

This MCP server provides shared tooling. It does not own the consuming repository's wiki content.

A server binds one trusted repository. It resolves that repository once, at
startup, from launcher- or server-owned configuration (see
[environment reference](env-reference.md)), and a launch that configures none
does not serve. Public agent requests carry no `repo` selector and no
filesystem root: every task operates on the configured repository, and no
prompt text, request payload, argv, claimed identity or agent-authored
environment selects another one. A request field that names a repository is
refused by the tool's closed schema rather than honoured or ignored.

The task tools, their request boundaries and the role that holds each one are
the [operation reference](mcp-operation-reference.md#operations) and its
[role authority](mcp-operation-reference.md#role-authority) section. This page
does not repeat them. `tools/list` is the authority for what a session can
call: a tool the session's role does not hold is absent, not refused.

Ownership follows from that single binding:

- Durable `docs/` pages and canonical `wiki/` records belong to the configured
  repository. Agents read them with `workspace_read_wiki` and change canonical
  records only through `workspace_create_record` and `save_record`; see
  [persistence](work-record-persistence.md). Raw JSON edits and shell patches
  are not an agent edit path.
- Work items, initiatives and decisions have JSON authority:
  `wiki/work-records/WK-####.json`, `wiki/initiatives/IN-####.json` and
  `wiki/decisions/DEC-####.json`. Their Markdown projections and the generated
  catalogue views are derived, never canonical, and reading a projection confers
  no record authority. Sources and areas use their Markdown documents.
- A reader subject is a canonical ID or a Markdown document path. JSON storage
  paths are not reader subjects.
- Documentation that ships with the tooling belongs to the launching package,
  not to the repository; see
  [Package-Owned Documentation Versus Workspace Pages](#package-owned-documentation-versus-workspace-pages).

Reads are compact first. `workspace_read_wiki` answers with bounded context and
the exact selection calls that read a field, entry, population or text whole;
follow those calls unchanged. A returned reference selects only the resource
the first answer named, under the same source and role grants. It never grants
arbitrary filesystem access, and the shared read core rejects path traversal
such as `../outside.md` or `wiki/work-records/../../escape.json` before any
read. Omitted detail in a compact answer is response shaping, not missing
canonical data: reach it through the returned selection, never by shelling out,
editing raw JSON or changing storage.

### Oversized MCP Response References

Default answers are bounded summaries. A complete value that exceeds the
ordinary bound is retained once by its producer and read through the selection
call the answer returned, on the tool that owns it: `workspace_read_wiki` for
wiki, record and package-document selections, `get_run_result` for execution
originals, and `query_code_index` for code-index answers. Selected full reads
are delivered through the shared authenticated response class as semantic
structured values and plain Unicode text.

There is no generic content reader. Callers never page byte ranges, decode
base64, verify a digest or reassemble a payload, and no response asks them to.
A missing or corrupt original, or a retention failure, is reported as that
failure and never as a compact success. The delivery bound, retained sources
and selected-full delivery are specified in
[selected-response details](mcp-selected-response-details.md). The one native
output exception belongs to
[`workspace_run_test`](local-test-runtime-setup.md#the-workspace_run_test-route).

### Host wiki-MCP process isolation

The launcher starts one host wiki-MCP server for each authenticated MCP command
invocation. Confined clients reach their independent server generations through
the launcher-owned private Unix-domain socket adapter. The socket endpoint,
credential file, pinned stdio connector, and connector Node executable are
projected into the sandbox; the wiki-MCP server package, dependency tree, cache,
and server runtime state remain on the host, outside the repository namespace.
See [MCP integration](mcp-integration.md#transport).

Role selection and tool authority come only from the frozen launcher binding.
Prompt text, request payloads, argv, ambient environment, repository settings,
and user settings cannot select a server, connector, mount, endpoint, or lifecycle.
The repository a server answers for is part of that same binding, so every call
a response emits is answered from the source the first call was bound to.

### Code index reads

`query_code_index` answers a code question for the server's bound repository.
It accepts no repository, root, cache or commit selector. Existing role, tier
and task authorization still apply; a returned call grants no authority.

Ask the question directly:

- `path` alone asks for file context: source, definitions and affected code.
- `symbol` asks navigation using an exact raw SCIP symbol returned by the index.
  Add `relationship` to ask only `definition`, `references`, `callers` or
  `callees`. Without it, all four are requested. A document-local symbol needs
  its document `path`; global symbol navigation rejects an accompanying path.
- `path` and `line` ask about symbols on that line. Lines are one-based; optional
  `character` is a zero-based safe integer, but resolution remains whole-line.
  Changing character cannot disambiguate symbols on one line. Ambiguous answers
  show distinguishable candidates and exact retained-candidate selections.
  Requerying a raw symbol may broaden a position to other native identities.
  Choosing one returned candidate with its relationship returns that native
  candidate's requested results immediately, with needed source inline or bound
  source calls. `result_state` distinguishes matched, no matches and unknown
  evidence; missing call attribution still qualifies an empty result.
- Exactly one of `paths`, `patchText`, `diffRecords` or `liveGit:true` asks
  potential change impact. `path` and `symbol` restrict seed paths: their union
  is intersected with the changed subject, without adding unchanged paths.
  Impact covers file definitions, not only edited occurrences inside hunks.
  Live Git selects changed paths; relationships describe the published index.
- `status:true` alone asks availability and material coverage/currentness limits.
  Status is not a prerequisite for code questions.

Empty `paths`, patch text or diff records explicitly select no changes. Missing
selectors and `liveGit:false` alone require a caller choice. No-change,
no-match, unresolved or ambiguous target, partial evidence, invalid/unsupported
input and unavailable index/source are distinct outcomes. An empty narrowed
scope is not proof of no impact when the symbol narrower is unresolved.
Unsupported diff kinds name the excluded change kind and endpoints in
`unsupported_changes`; the caller must choose the actual supported change kind.
More excluded changes use the returned retained selection. They do not supply
evaluated impact paths.

Ordinary questions use the last usable published index without waiting for
indexing. They retain the producer's complete answer once and keep its existing
background-refresh effects. Status and detail request no refresh or preparation.
The public answer contains the requested code meaning and material limitations,
not routine commit/tree/digest comparisons or provider inventories. References
do not establish calls, implementation relationships or test identity. Missing
call attribution and partial symbol coverage cannot establish absence.

Small source extents are delivered with the answer. When more meaning is needed,
follow the returned exact `next_calls` selection. Locations needing source offer
their bound region/file read. A selected read returns its complete semantic
selection in one delivery, evaluates no query and retains no second original.
Native affected relationships offer the related source extent rather than
unrelated file content. If source verification fails, `source_limits` names the
cause on the affected file; the recorded relationship is not erased. A complete
file is offered when no narrower native extent exists and that file is available.
There are no cursors, ordinals, byte ranges, decoding or agent integrity checks.
If the answer is sufficient, continue the caller task without rereading.

`detail` carries the issued `source:{ref_id}` and collection. Semantic filters
(`selector.id`, `path`, `symbol`, `relationship`, `input_path`) select from the
same original and remain conjunctive. `input_path` qualifies one affected file.
`lines:{start_line,end_line}` selects absolute, one-based inclusive source lines
inside the context `source` member, one region selected by ID, or one complete
file selected by path. Invalid selections return an exact inspection call when
the authenticated original permits it; that inspection enables a choice and
does not claim to answer the rejected selection. Provider/graph snapshots,
patch echoes, raw diagnostics and provenance are not public detail collections.
Successful detail reads keep the issued source handle and requested meaning;
they do not echo selection arguments or repeat the delivered population counts.

Selected source bytes are checked against the index's file descriptor before
retention. Changed, absent, corpus-excluded, nonregular or undecodable content
has an explicit source reason. Later reads keep previously captured bytes;
material movement or unavailable currentness is reported without internal
comparison identities. A missing/corrupt/foreign original is never replaced by
rerunning its query. The exact retained impact handle remains usable by an
already authorized impact-evidence consumer; that consumer receives the complete
authenticated original server-side.

No usable index returns `available:false`, its specific cause and the condition
that prevents answering. Pending preparation requires a published index; failed
preparation requires correction of its reported cause. Neither recommends an
unchanged question loop. A preparation call is offered only if the current
registrar actually holds it, and explicitly requires task authorization for
maintenance. Status and reading a selection never perform that maintenance.

Index/checkout equality is not reviewed-source alignment. This route has no
trusted launcher review-target binding or reviewed-version reader. It cannot
establish a finding about an independently selected reviewed version merely by
being current. Other-source code can be supplemental; unavailable exact reviewed
content limits only conclusions that need it. Adding that guarantee requires
the shared launcher/source-reader owner to supply the trusted binding and exact
read; caller-supplied hashes or a new unbound commit selector cannot supply it.

Planning queries use exact provider-qualified SCIP identities. File context includes
`definitions` in the input, incoming references to those definitions, and outgoing
references with their resolved definitions. Impact seeds every definition in each
accepted file, including for partial-file hunks, and reports potential impact.
Files that merely share an imported utility are not consumers. Local symbols stay
scoped to their documents. Native repetitions survive; overlapping TypeScript
projects share the navigation owner's multiplicity rules.

Public `semantic_relationships` selections describe the input path, direction,
raw symbol and related path. `semantic_resolution` distinguishes unresolved,
external and ambiguous outgoing references without choosing an arbitrary
definition. Source selections keep useful locations, verified checkout content
and precise source failures. Native provider identities, hit-link populations,
provenance and coverage carriers stay in the server's retained original;
public answers state the material limitations instead. Same-file references
remain evidence without making the file its own affected consumer. Unavailable
evidence cannot establish absence of consumers. References imply neither calls,
implementations nor test identity.

`related_code_paths` contains only evidenced native or import relationships.
Canonical records join actual input/evidence paths through explicit declarations,
patterns, documentation backlinks and related IDs. An exact published descriptor
check establishes file existence; declared directory ancestors use batched
existence-only prefix checks. Existence never establishes a code relationship.
Suppressed records require explicit `includeSuppressed: true`.

A change-impact question supplies exactly one subject — `paths`,
`patchText`, `diffRecords`, or `liveGit: true` — plus optional
`includeSuppressed`, and `path` or `symbol` to narrow it. Empty `paths`, `patchText`, and
`diffRecords` are explicit no-change requests. Mixed subjects, unknown keys,
malformed diff records, and diffs beyond 1,048,576 normalized bytes, 20,000
lines, or 1,000 records are refused as invalid requests. Live Git only selects
changed paths; relationships and canonical records describe the selected
publication. The answer carries `impact_state` (`evaluated`,
`partial`, `no_change`, `invalid_input`, or `unsupported_input`) with reasons and
denominators, `affected_files` whose relationships name their basis (`scip`,
`graph`, or `canonical_record`), semantic relationships, allowed structural
impacts and diff diagnostics. Reverse-import rows belong only to the recorded
edge's importer, carry its actual endpoints and edge identity, and are direct
exactly when their target is the input module; transitive rows describe dependency
through the import graph without claiming a reconstructed chain. Explicit docs
and scope links remain metadata. Literal MCP registration patterns in reachable
files are qualified lexical observations. Directory/basename suggestions and
heuristic test, CLI and schema labels are absent. It
never exposes raw graph nodes or edges. CLI `wiki code-index impact` accepts
exactly one of positional or `--paths` paths, `--patch`, `--patch-file`,
`--diff-records-json`, or `--live-git`, with the same `--json`/`--verbose`
output.

## Agent Graph Impact Recipe

### Automatic index preparation

The index serves the current working checkout, including tracked edits and
untracked source files admitted by the native project configuration. Git owns
file membership and ignore handling (`ls-files --cached --others
--exclude-standard`); file contents and modes come from the checkout. The
source filter excludes `wiki/`, dependencies, generated output and runtime
state before content is read. Indexing never archives or extracts the repository.

`ensureSidecarIndex` owns build and refresh. It compares content identities of
current source/configuration inputs with the publication and compares each
provider's source inputs, executable, settings and dependency population using
`sidecar-scip-project-inputs.mjs`. A changed HEAD alone does not rerun a provider
or copy the database. Changed base sources are compared with the published file
descriptors; only affected extraction units and changed provider projects run.
Explicit rebuild requests reset the derived schema in the canonical database. The extraction basis is
`working_checkout.v6`; incompatible publications are rebuilt through the same
owner, without an old-contract read path.

One repository-wide `withSidecarUpdaterLock` owns indexing across processes and
cache destinations. Its SQLite EXCLUSIVE transaction is the atomic admission
mechanism. An occupied indexing lock is checked again after ten seconds. After
acquisition, the caller rechecks the publication before doing provider work.
Process-local admission and joining remain capacity controls, not the repository
mutex. Published readers never acquire this updater lock.

The lock owner records its non-reusable process identity (PID, start time and
boot ID) and the exact private workspace path in
`.cache/repo-code-index/.index-owner.json` before creating a
`sidecar-scip-job-*` temporary directory. That directory holds provider output
and private compiler scratch outside checkout ancestors. Provider process groups
record their identities there too. The next lock holder recovers a dead or stopped job's scratch (a live caller
process without the held mutex is a stopped job), terminates any surviving recorded provider group after
identity verification. Each store lock holder also removes exact UUID candidate
SQLite files and their transaction files from that store directory, even when
the old temporary workspace no longer exists. All historical candidate writers
held this mutex: exclusive acquisition proves they cannot still be publishing.
A competing live writer keeps the mutex and its artifacts. Unrelated files,
directories and symlinks are preserved.
PID reuse is evidence that the recorded process died; directory existence and
elapsed time are not liveness tests. Indeterminate ownership fails with the
specific cause and leaves artifacts intact. Success and handled failure remove
the owned scratch and ownership record. Recovery never removes the published
index, shared dependency caches, another live job or unrelated temporary files.

Providers run installed executables with `shell:false`, bounded time and retained
diagnostics, and process-group cleanup. Stderr is continuously drained through
termination; its volume never determines success or failure. At most 64 KiB of
stderr bytes are retained, split equally between beginning and end. Truncated
diagnostics include an explicit marker within that byte budget and omit partial
UTF-8 characters at clipped boundaries. Internal process errors retain emitted
byte counts, truncation state, bounded evidence and the exit code/signal when
available through the error cause chain. Agent responses do not gain raw log
payloads. Diagnostic stdout retains its existing 4 KiB beginning and 4 KiB tail;
machine-readable probe stdout still fails above its separate 4 MiB capture limit.
Deadlines and process-group cleanup still apply, and a zero exit still requires
valid SCIP output. Nothing installs dependencies or invokes `npx`.
TypeScript/JavaScript use nested tsconfig/jsconfig projects and native references,
includes and excludes, with installed node_modules available in place. Python
uses each source's nearest native project/package configuration. A tool-only
`pyproject.toml` without packaging metadata or native pyright settings does not
create a Python project boundary; enclosing imports and definitions keep their
provider-native identity. Each Go module
uses its native workspace and contained local replacements, with an offline
module cache and private HOME, GOPATH and build cache. Rust discovers Cargo
workspaces, native toolchain selections, members and contained path dependencies.

The local npm install and prepared-image provider stage use
`@sourcegraph/scip-python` 0.6.6 with `@iarna/toml` 3.0.0. The installation owner
in `tools/in0012-deepswe-smoke/code-index-providers.mjs` verifies the published
vendor bundle's digest and redirects its bundled TOML module to that pinned
dependency. This accepts TOML mixed-type arrays, including dependency-group
inline tables followed by strings. Installation repair is idempotent and refuses
unknown provider bytes or dependency versions. Image provenance records the
parser's registry integrity and the original and installed bundle digests;
verification checks the installed repair. Configuration syntax errors retain
the parser's exceptions and the provider's explicit diagnostics.

TypeScript configurations are resolved with the installed provider's own compiler.
A directory and its default `tsconfig.json` identify the same configuration;
`jsconfig.json`, named variants and reference-only configuration files retain
their distinct identities. Reference-connected configurations share one sequential
execution and one provider contribution. The shared driver uses the installed
native `ProjectIndexer`, source/configuration caches and SCIP serializer, visits
each resolved configuration once, and uses the checkout root consistently for
native package identity. Independent configurations execute separately. Singleton and grouped
configurations use the same shared driver and configuration interpretation. No source configuration or
serialized symbol is rewritten, and overlapping source membership keeps the union
of native facts with occurrence multiplicity preserved.

The repository's npm postinstall and the prepared image's provider layer use
the same installation owner, `tools/in0012-deepswe-smoke/code-index-providers.mjs`,
to apply the checked documentation repair to `@sourcegraph/scip-typescript@0.4.0`.
Its `FileIndexer` documentation renders unpaired UTF-16 surrogate code units as
literal `\uXXXX` escapes before the native protobuf serializer sees them. Valid
surrogate pairs and ordinary Unicode remain unchanged. This preserves inferred
literal types without changing source bytes, symbol identity, occurrences or the
indexing architecture. The installer accepts only the pinned upstream module or
its exact repaired bytes and is idempotent. Image provenance retains the npm
version/integrity plus the repair identity and upstream/repaired module hashes;
runtime verification checks those hashes against the installed module. Provider
updates require an explicit repair update. Incoming SCIP still uses the unchanged
strict UTF-8 decoder, including for external provider output.

Coverage records the group's resolved `membership.configurations` and, for shared
executions, each member's native outcome and emitted document count in
`configuration_coverage`. An empty solution configuration constructs no compiler
program. Missing members retain their configuration diagnostics and dependency
limitations beside usable group output. Invalid configuration members retain
`configuration_error` with compiler diagnostic codes; absent inputs retain
`configuration_unavailable`. Both leave independent usable configurations
queryable. Provider/process failures and timeouts preserve the prior publication. `provider_projects_run` and
`provider_projects_reused` count execution contributions, not configuration
traversals. The member outcomes distinguish these counts.

Group membership, configuration/reference inputs, dependencies, toolchain and the
fixed `canonical-projects.v2` execution contract participate in existing input
identity. The resolved compiler package is part of dependency identity even when
it is outside the indexer's tool population. Old execution settings require normal refresh. Unchanged preparation
launches no indexers, and unchanged independent contributions retain their stored
output. TypeScript source invalidation remains repository-wide; shared caches and
the visited configuration set last only for one execution.

Each TypeScript SCIP process runs its captured Node executable with
`--max-old-space-size=8192` before the native script or shared driver. Global caches remain
enabled. The 8192 MiB old-space ceiling is neither an 8 GiB reservation nor a
total-RSS cap. This fixed runtime setting is part of the provider-input settings
identity: a missing or different published setting is stale in both passive
currentness and preparation; matching unchanged records reuse normally. Other
providers retain their runtime arguments, projects execute sequentially, and the
default per-provider deadline remains `300000` ms.

Stable Cargo writes lockfiles alongside manifests. Rust therefore uses narrowly
scoped private Cargo configuration scratch: only Cargo manifests, lockfiles,
`.cargo/config[.toml]`, its selected repository include closure, and toolchain
selection files are copied. Directories on the manifest and configuration spines
preserve workspace, relative dependency and include paths; source and
resource entries are symlinks to the actual checkout. No source or wiki content
is copied. rust-analyzer's native `linkedProjects` configuration selects those
private manifests while the indexer's project root remains the checkout. Cargo
metadata, lockfile diagnostics and compilation operate in owned scratch; the
checkout's lockfile presence and bytes remain unchanged. External Cargo-home
configuration and dependency caches retain their existing owners.

Rust's Cargo input owner parses TOML to enumerate configuration include edges,
including mixed strings/tables, nested relative `.toml` paths and optional entries.
Cargo retains value interpretation and merge precedence. Selected repository
configuration stays in its exact relative layout in private scratch; no replacement
config is generated. Cargo-home includes remain in the selected Cargo home.
Include targets must remain within their owning repository or Cargo home, including
through symlinks. Malformed TOML/include declarations, cycles, permissions and
confinement failures remain specific failures, as do Cargo/provider crashes,
timeouts, invalid output and unusable lockfiles.

A genuinely absent required include produces `scip_rust_config_input_unavailable`
with its declaring config and target. Cargo workspace membership remains
`unobserved`: each affected manifest candidate is accounted for without guessing
workspace membership, and discovery/indexing are not attempted for that candidate.
The existing unavailable-project coverage preserves healthy sibling indexing.
A repository with only unavailable projects still publishes truthful coverage and
completes setup. Restoring the include and explicitly building recovers navigation.
Included config paths and their bytes use the existing provider dependency identity;
symlink targets are measured too. Changes invalidate affected projects while unchanged
inputs reuse their result. Exact optional targets found absent are recorded in Rust's
existing settings/currentness facet, so later presence is observed without scanning
ignored directories. There is no background watcher, dependency acquisition or
caller config/lockfile mutation.

Project discovery uses the same regular-file mode eligibility as preparation.
Symlink entries retain their checkout identities and containment rules, but are
not selected as manifest/configuration candidates. Regular-file read failures
remain failures.

A Cargo manifest establishes a candidate. Cargo alone establishes workspace
membership; a failed `locate-project` with Cargo's configuration exit status
retains `scip_rust_workspace_unresolved`, its manifest scope and concrete cause,
with membership `unobserved`. Other valid workspaces continue, including nested
independent workspaces. No manifests are rewritten and no test/example/fuzz
directory convention excludes a candidate.

Project-selected toolchains that are absent produce unavailable project coverage
with `scip_go_toolchain_unavailable` or `scip_rust_toolchain_unavailable`. A failed
probe alone does not establish absence. Go's local compiler supplies structured
configuration/version/platform facts and executable observation establishes absent
selected locations. Rustup selection inputs and its installed-toolchain inventory
establish absence only for an observed rustup proxy. Process crashes, timeouts,
failed launches, permission errors and invalid successful probe output retain their
specific failure codes. Primary and secondary dependency/probe causes stay visible;
human-readable stderr never determines a cause. Healthy projects continue beside
unavailable candidates, and an all-unavailable checkout finishes setup with semantic
coverage explicitly unavailable. Unchanged limited results reuse existing output;
restoring prerequisites and explicitly building retries them.

Go workspace facts live in wiki-core's `runtime-inputs/go-workspace.mjs`: nearest
workspace, membership, local replacement references and lexical containment.
Indexer discovery supplies the admitted checkout file population. Launcher test
setup supplies its filesystem inputs and retains its strict usable-workspace
validation; indexing retains whatever output its native provider can produce.

Missing executables produce explicit inactive coverage. Missing required TypeScript
configuration inputs, Go dependencies or Cargo dependencies retain their owner-reported
limitations and whatever usable navigation the provider produced. A dependency
that prevents loading a project is recorded as unavailable; unrelated provider
crashes, timeouts, invalid output and unexpected failures retain their specific
causes. TypeScript configuration observation uses the installed provider's compiler
resolution and structured diagnostics, including relative extends, installed-package
config files and project-reference targets. These limitations use
`scip_typescript_config_input_unavailable`. Only missing-input diagnostics qualify;
malformed configurations and other I/O failures do not. The provider still runs,
and usable output remains published with partial coverage. A blocked project with
no output is unavailable, while healthy siblings remain queryable. Even when no
project is usable, publication and the setup build complete with truthful coverage.
Restoring the input and explicitly building again recovers the project. Compiler-read
configuration outside the normal checkout input set participates in the existing
dependency content identity: installed package populations keep their package boundary,
and other files, including ignored generated config, are measured individually.
There is no ignored-output scan, generator invocation or additional watcher.
`sidecar-scip-typescript-config.mjs` owns interpretation for discovery, execution
and empty-project verification through the installed compiler. Structured member
outcomes establish configuration-only/empty, missing-input and invalid-config
coverage. No stdout/stderr phrase determines these outcomes. Provider loader
failures, crashes and malformed output remain failures even beside missing config.
An empty native TypeScript project is distinguished from dropped nonempty output
using the installed compiler. Source documents outside the indexed corpus and
unresolved external symbols remain coverage gaps, not fabricated navigation.

The internal `repo-code-store.v7` schema keeps a provider-qualified symbol-to-defining-document
lookup in the existing `graph.sqlite` database. Publication derives its entries from
native occurrence definition role bits, including definitions with additional role
bits. Each provider project retains its own entries, multiple defining documents
remain distinct, and local symbols require their document identity. The lookup is
updated in the same transaction as provider documents and interned strings: changed
or moved definitions, reference-only replacements, document and provider deletion,
and scoped provider replacement all update it atomically. Unchanged document
payloads reuse their existing lookup entries; rollback preserves the prior publication
and lookup. Older store schemas are incompatible and use the existing derived-store
rebuild route.

Outgoing semantic queries select defining document IDs through this lookup before
reading or decoding document payloads, including compressed payloads. Other consumers
of a shared symbol do not expand that selection. External or unresolved symbols
without definitions select no definition documents and retain their resolution
evidence. Incoming-reference queries still select every actual consumer. Native
symbol and occurrence identities, ranges, roles, provider distinctions, ambiguity,
and complete selected retrieval retain their existing meaning.

The repository maintains one graph database at `.cache/repo-code-index/graph.sqlite`.
Prepared deltas update it directly under the existing writer mutex. SQLite WAL
transactions commit changed rows and the publication completion tag together;
open readers retain their coherent snapshot across a write or schema reset.
There are no full database copies or replacement database publications.
A rebuild resets the derived schema at that same path before applying the new
build. Failed builds report their concrete cause. A failed rebuild after reset
reports `publication_outcome: unpublished` and has no complete indexed commit;
retry uses the ordinary rebuild path. Transaction failures may preserve the prior
publication (`prior_preserved`), but preservation is not a rebuild guarantee.
An error after commit reports `published_with_error`.

Status distinguishes `artifact_exists` from `artifact_usable`, retains the observed
`artifact_schema_version`, names `expected_artifact_schema_version`, and reports
its concrete read error. Incompatible schemas are rebuilt, never relabelled.
An unavailable query carries that evidence and its recovery/refresh state,
including running, failed with cause, or unavailable when refresh was disabled.
Public informational queries use an available publication without reading and
hashing the whole checkout. The existing refresh coordinator does that work in
the background. Until checked, same-HEAD freshness is `unknown` with
`checkout_freshness_unverified`; a changed HEAD or already observed input movement
is `stale`. Selected source text still requires the descriptor content check.
Cold queries request normal background recovery. Public status remains read-only
and uses the same unverified freshness qualification. Internal admission checks
retain explicit checkout verification through the existing status owner.

`graph_snapshot.base_coverage` identifies `input_basis: working_checkout`, the
`checkout_identity` and `inputs_moved`. Source/configuration movement during a
build is reported honestly and leaves the normal refresh path available; a
clean checkout or stable commit is never a new readiness prerequisite. Source
assembly reads the selected checkout file and compares its content digest with
the indexed descriptor. A changed file reports `checkout_source_changed` instead
of attributing current text to old occurrences. It never substitutes a Git blob.

`graph_snapshot.repository_commit` and `repository_tree` are Git observations at
preparation, not exact-content claims. `indexed_commit` preserves the published
snapshot's `repository_commit`, with its first 12 characters in
`indexed_commit_short`; both are null when that snapshot supplies no commit.
They never substitute the request's separately observed `current_head` or claim
that dirty checkout bytes equal a Git tree. The authoritative index identity is store
incarnation plus publication sequence and checkout/provider input identities.
Retained-answer currentness compares checkout inputs and publication identity;
a same-HEAD source edit reports a changed observation before refresh finishes.
Provider coverage names `input_basis`, `input_identity` and `observed_head`.
Python and Go use the truthful `working-checkout` project version, independent
of commits. Context uses `freshness_basis: checkout_input_identity` and
`graph_basis: working_checkout`.

SCIP decoding and normalization retain provider-native occurrences, stable
symbol identities, roles, resolution, and one-based inclusive whole-line source
and enclosing ranges. Invalid ranges are omitted and counted. Definition and
reference navigation remain based on those native occurrences; call edges are
emitted only where the provider supplies enclosing ranges.

### Existing runtime calls

Graph impact is an agent workflow checkpoint, not a primary manual user
workflow. After canonical wiki/docs retrieval identifies the assigned `WK-*`,
durable docs, and candidate implementation paths, a session that holds
`query_code_index` should:

1. call MCP `query_code_index` with the repository-relative `paths` it may
   edit
2. after a diff exists, call MCP `query_code_index` with parsed `diffRecords`,
   raw `patchText`, or `liveGit: true`

No status call is a prerequisite; `query_code_index` with `status: true` is
available when the published commit itself is the question. The route returns a
compact answer bound to its retained complete original by
`selected_detail.source`; read that original through the returned `detail`
selection.

Explicitly requested operator CLI work may use `npm run wiki -- code-index impact --paths <path>`
or `npm run wiki -- code-index impact --live-git`. A missing MCP grant does not
authorize switching to an operator CLI. The CLI preserves the same trust envelope: graph evidence
is derived code index evidence, while durable `docs/` pages and canonical
`wiki/` records remain authoritative.

Final answers and handoff notes that rely on code impact should state the
queried change scope, the useful affected-code meaning and any coverage or
source limit that changes the conclusion. A post-diff impact query is needed
only when the assigned task needs it. Do not copy provider state, index digests
or successful integrity checks into the handoff.

## Package-Owned Documentation Versus Workspace Pages

Two different owners hold the bytes a read can return, and confusing them is
what made discovery advertise a documentation path a consuming repository did
not contain. `workspace_read_wiki` reads both, and the request says which:

- A `subject` or `search` reads what the CONFIGURED REPOSITORY owns: its
  canonical records and its own pages. It never reinterprets a package path.
- A `reference` of `{tool_name, path}` reads documentation the launching
  PACKAGE owns, resolved against the documentation bundle that package
  supplies. It accepts only a tool the session can currently see plus one of
  that tool's currently advertised package-scoped logical paths, and it reads
  only manifest-contained bundled files. The answer states the owning package
  and version with the document's digest and size, and returns the selection
  that reads its whole text.

Which owner applies is decided by descriptor provenance, not by probing which
filesystem happens to contain the relative path. Built-in AgentChassis
descriptor references are package-scoped. When the same logical path exists in
both places the declared owner wins deterministically, so a repository file can
never shadow a package-owned built-in reference and a package-owned reference
never falls back to the configured repository. Every refusal on that boundary
carries a stable typed code; the codes are tabulated in
[Package-Document Read Diagnostics](tool-discovery-schema.md#package-document-read-diagnostics).

The documentation bundle reaches the server as a closed carrier value handed
over by the package that owns it — today `@agent-chassis/core`'s forwarding bin,
derived from its own module location and its own `package.json`. There is no
environment variable, caller-supplied root, ancestor-package search, hoisting
assumption, or repository fallback that can produce one. A standalone
`@agent-chassis/wiki-mcp` launch therefore carries no documentation bundle, and
its reader refuses a package reference with the carrier-unavailable code.

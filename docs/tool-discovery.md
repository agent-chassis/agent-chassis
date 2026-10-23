# Tool discovery

The production wiki-MCP server advertises the current session's tools through
MCP `tools/list`. Use those exact names and schemas and follow the next calls
returned by their owners. A descriptor, imported registrar, package file or
historical example does not establish that an operation is callable.

The [MCP operation reference](mcp-operation-reference.md) owns the current task
inventory and role boundaries. The production surface exposes no shared
`workspace_tools_list`, `workspace_tools_describe`, intent-router or generic
spill-reader tool, and retired task names are not aliases.

## Finding the next operation

- Saved work, unknown record identities, documents and frozen assignments start
  with `workspace_read_wiki({reads:[Read,...]})`. One selection is a request of
  length one. Read known subjects and public semantic selections directly, mixing
  needed fields, contract meaning, documents or other granted kinds in one call.
  Use search, context or choice inventories only for missing information; a known
  source and selection need no preliminary context read. Preserve issued source
  bindings and resolve ambiguity using returned choices. See the [reader
  contract](workspace-read-wiki.md).
- New records start with `workspace_create_record`; changes use `save_record`
  with the unit's current combined revision. Ordinary prose, criteria, scopes,
  validation and slices remain supported. Selected schemas describe the session’s authorized operations; syntax alone grants no execution authority.
- Proof discovery starts with `workspace_find_proofs`. Read each plausible
  candidate's complete assertion, exclusions and authoring facts before selecting.
- Published code questions use `query_code_index` only when the session grants
  that operation. Use entitled repository read/search tools and disclose incomplete coverage.
- Starts and previews use `start_agent`. Results use `get_run_result` for the
  returned subject/attempt or original. Integration uses `integrate_work` for
  the exact authenticated delivery and is never an observation side effect.

The launcher names this session’s complete generated guide and authoring vignette at startup. Schema validity,
authored completeness, executable support and permission to take the next action
are separate facts. Returned templates requiring caller choices are not complete
executable corrections.

## Registration and metadata owners

Checked-in `tool-discovery.v1` fragments supply metadata for the registration
boundary. Actual registration, the central role grants and dispositions,
registered tier, descriptor visibility and install/runtime posture compose the
exposure decision. Audience prose grants no capability. Missing or inconsistent
classification fails closed.

The shared reader declaration lives in `data/tool-discovery/mcp-tools.json`
inside `wiki-core`. The owner assembler feeds compact and verbose metadata
projections and the architecture prototype's `operation-graph.mjs` and
`tool-map.mjs` views. Those views reuse declared meaning; they neither override
the reader contract nor establish live availability or behavioral analysis.
Committed prototype renderings are snapshots and require their owning refresh
when metadata changes.

Descriptor metadata and runtime advertisement must agree. Conformance checks
reconcile booted registration as well as static metadata; source inventories
cannot observe an unlisted registration by themselves. Descriptors and public
responses state effects, limitations, the specific refusal cause and supported
recovery. A passing metadata check establishes none of the operation's semantic
or runtime guarantees.

The detailed metadata vocabulary lives in
[fragment registry](tool-discovery-fragment-registry.md) and
[descriptor schema](tool-discovery-schema.md). These are implementation contracts,
not additional agent discovery endpoints. Public retrieval is described in
[discovery surfaces](tool-discovery-surfaces.md), and exposure in
the session’s supported tool information.

## Advisory review and execution evidence

Findings-only review starts through `start_agent`, with the authenticated subject
or exact source range its owner accepts. Consume the advisory text returned by
`get_run_result` directly. Schema diagnostics can make formal attestation
unavailable without invalidating captured findings. Results, severity, agreement
and saved dispositions do not integrate, approve or complete work.

Native tests use `workspace_run_test`; saved proofs use `verify_proof`.
For repository scripts or wrappers, use `harness:{cwd,argv}` with a repository-relative
directory and literal executable/arguments. This executes once without reconstructing
framework commands; optional `environment` selects the installation independently
of cwd. Harness execution excludes `file`, `runner` and `selector`.
Results state what actually ran and bind evidence to source. Both invoke the
separate authenticated host test capability, which has host permissions and no
filesystem or network confinement guarantee. An absent recorded execution is
not a pass. See [test execution](test-proof-execution.md) and
[selected results](mcp-selected-response-details.md).

## Local advisory feedback

During work, all managed roles can use `workspace_record_feedback` for confusion, limitations and model token waste. Direct workers use `wiki feedback add --stdin --new-session|--session <id> --json`, without MCP. Feedback appends only repository-local runtime state and grants no canonical or lifecycle authority. See [Local agent feedback](agent-feedback.md) for sessions, carrier capacities, package provenance, and errors.

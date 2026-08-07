# Tool Discovery Registered-Tier Exposure

Backlink: [Tool Discovery v1](tool-discovery.md).

This page is the canonical reference for tool discovery as a registered-tier
projection: the `free_local` / `paid_cce` / `operator_only` vocabulary, canonical
tier resolution, the free/local messaging boundary, per-tier prose, and how the
`agent-safe` audience gate composes with tier exposure.

## Registered-Tier Exposure And Projection

The system ships as two products over one codebase (see
[docs/enforcement-model.md](enforcement-model.md), `decision`, `decision`,
`decision`): a source-available free/local product and the Chassis Control Engine (CCE) tier. Tool discovery is a **tier projection**, not a single global
corpus shown to every registration. The checked-in descriptor corpus may carry
full metadata and per-tier prose, but `workspace_tools_list` /
`workspace_tools_describe` / `workspace_tools_query`, the agent FAQ, live MCP tool
descriptions, and mixed-route default responses render only the tool information
relevant to the **resolved registered tier**.

### Registered tiers

Each entry declares a `tier_visibility` array over the controlled vocabulary:

- `free_local` — visible to a free/local no-key registration (and, by superset, to
  a CCE registration).
- `paid_cce` — visible only to a registration whose CCE-key posture is positively
  resolved.
- `operator_only` — surfaced only to an operator-tier caller; CLI fallback rows and
  operator entrypoints carry this so they are never agent-visible free escape
  hatches for CCE MCP surfaces.

Exposure composes as a fail-closed superset: a free/local registration sees
`free_local` entries; a CCE registration sees `free_local` plus `paid_cce`
entries. An entry with missing or unknown tier metadata is visible to **no** tier —
missing classification fails closed rather than defaulting to free/agent-visible.
A tool is exposed only when **both** the selected role profile (`full`,
`agent-safe`, `worker`) and the resolved tier allow it; role profile alone is never
authority to expose a CCE surface or CCE explanation. `tier_visibility` composes
with, and does not replace, `audience`, `recommended_route`, `runtime_posture`, and
`side_effects`.

### Tier resolution is canonical, never caller-asserted

The runtime registered tier is resolved from the canonical CCE/Node Engine
key/no-key posture described by [docs/enforcement-model.md](enforcement-model.md),
`decision`, `decision`, and `decision` — a positively-resolved CCE key
selects the CCE tier; its absence, an unreadable config, or any uncertainty
fails closed to free/local. The tier is **never** derived from caller-supplied
request data, prompt text, argv, ambient child env, claimed identity, or ad hoc
local inference. Uncertainty or an invalid CCE-key posture must not expose
CCE-only tools or CCE-only explanatory text.

### Free/local messaging boundary (decision / decision)

`decision` and `decision` are load-bearing for messaging. A free/local
confirmed-no-Node-Engine posture renders **no local admissibility judgment**: it
may expose structural runnability and containment guidance, but local LOC, cluster,
blast-radius, target-resolution, and threshold analysis must **not** be presented
as free-tier guidance, advisory policy, recovery detail, or agent-usable tooling.
There is no local "advisory" admissibility code. Free/local discovery, FAQ, and
default output must not name CCE metric/leverage concepts or route agents to
CCE-only tools as ordinary remediation.

### CCE projection

CCE registrations may expose the CCE leverage and authorization surfaces:
worker-admission carrier facts, Node-Engine-returned verdicts / reason codes /
remediation, review evidence, attestation, CCE admission diagnostics and recovery,
worker-admission LOC / admission-metrics / target-resolution refresh,
graph-impact / blast-radius / multicluster code-index queries, and graph-impact
evidence persistence. CCE messaging must **distinguish raw measured carrier facts
from Node-Engine-returned admissibility judgments** and must not imply the local
layer renders its own threshold verdict under `decision`.

### Per-tier prose (`tier_text`)

A mixed route that is visible to both tiers carries a free/local-safe base body and
an optional `tier_text.paid_cce` override. Projection strips the internal
`tier_text` container from output, applies the resolved tier's override, and — for
an unknown/absent tier or a missing CCE override — degrades to the free/local base
rather than falling through to CCE text.

### Free vs CCE boundary examples

- Free/local coordination substrate stays visible: canonical wiki/docs
  read/search/discovery, work-record create/edit/validate/summary, lint/generate,
  structured dispatch and run monitoring, and declared validation routes that do
  not mint CCE authority or teach CCE-only analysis.
- CCE-only (or operator-only): `workspace_record_review_attestation`,
  `workspace_record_review_result_evidence`, `workspace_node_engine_admission_runtime_diagnostic`,
  worker-admission LOC/admission-metrics and target-resolution refresh, the
  code-index / graph-impact query family, and graph-impact evidence persistence.
- `workspace_validate_dispatch` and `workspace_agent_dispatch` remain free/local for
  basic dispatch-readiness and launch flow, but their free/local discovery and
  default output must not expose CCE LOC/threshold/blast-radius/multicluster,
  CCE-recovery, structural-admissibility, or structured review-artifact detail.
  Validation may refresh only the ignored current-HEAD graph cache described in
  [Discovery Surfaces](tool-discovery-surfaces.md#discovery-surfaces); this cache
  write does not confer CCE authority or mutate the carrier.

### `agent-safe` / `agent-authoritative` are not tier labels

`agent-safe` and `agent-authoritative` describe structured-route/profile posture,
not product-tier availability. They may be used only when clearly qualified;
registered-tier metadata remains the sole authority for free/local versus CCE
exposure. Do not read either label as a free-tier availability signal.

For MCP runtime exposure, the `agent-safe` profile is derived from the
checked-in tool-discovery descriptor, not from a hand-maintained allowlist.
An MCP tool is eligible for `agent-safe` exposure only when its descriptor
entry has `kind: "mcp_tool"` and the raw descriptor value satisfies
`Array.isArray(entry.audience) && entry.audience.includes("agent")`. The
descriptor `audience` field is therefore the authoritative agent-exposure
control for MCP tools; caller text, prompt intent, argv, environment, wrapper
names, and inferred defaults are not exposure authority.

The audience gate is default-deny. Missing `audience`, an empty array, a
non-array value, or any non-literal/substring value such as `"agentic"` or
`"agent-preview"` does not make a tool agent-safe. The runtime exposure gate
must use the raw descriptor array membership test above; it must not apply
tool-discovery audience defaults that are intended for descriptive projection.

`agent-safe` audience eligibility composes independently with registered-tier
exposure. A tool is callable through an `agent-safe` MCP server only when both
the descriptor audience gate and the registered-tier gate allow it. A
`paid_cce` tool whose descriptor audience includes `"agent"` remains hidden from
free/local registrations, and registered-tier visibility never grants
agent-safe exposure to an MCP tool whose descriptor does not explicitly include
the literal `"agent"` audience.

### Terminology disambiguation

Response-shape language such as the code-index compact/degraded/verbose contract is
about payload size, not availability. It is **not** a product tier: do not confuse
a "three response-shape mode" contract with `free_local` / `paid_cce` /
`operator_only` tool exposure.

### Free-tier run monitoring under decision

In the free/local tier, `workspace_agent_run_wait` and `workspace_agent_run_status`
can report terminal success while `structured_role_result.valid:false`, because
`decision` free-tier reviewer/redteam/worker output is prose-only and non-attesting.
That value is expected, non-attesting state — not a failed child run, a failed
dispatch, or missing findings. A schema-valid structured role result is a CCE
capability enabled only by a configured CCE key.

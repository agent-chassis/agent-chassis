
# Tool Discovery Registered-Tier Exposure

Backlink: [Tool Discovery v1](tool-discovery.md).

This page is the canonical reference for tool discovery as a registered-tier
projection: the `free_local` / `paid_cce` / `operator_only` vocabulary, canonical
tier resolution, per-tier prose, and how the compatibility-named `agent-safe`
audience gate composes
with tier exposure.

## Registered-Tier Exposure And Projection

Tool discovery is a **tier projection**, not a single global corpus shown to
every registration. The checked-in descriptor corpus may carry full metadata and
per-tier prose, but `workspace_tools_list` / `workspace_tools_describe` /
`workspace_tools_query`, the agent FAQ, live MCP tool descriptions, and
mixed-route default responses render only the tool information relevant to the
**resolved registered tier**.

### Registered tiers

Each entry declares a `tier_visibility` array over the controlled vocabulary:

- `free_local` — visible to a free/local no-key registration (and, by superset, to
  a Chassis Control Engine registration).
- `paid_cce` — visible only to a registration whose CCE-key posture is positively
  resolved.
- `operator_only` — surfaced only to an operator-tier caller; CLI fallback rows and
  operator entrypoints carry this so they are never agent-visible.

Exposure composes as a mechanically closed superset: a free/local registration sees
`free_local` entries; a CCE registration sees `free_local` plus `paid_cce`
entries. An entry with missing or unknown tier metadata is visible to **no** tier —
missing classification yields no exposure rather than defaulting to free/agent-visible.
A tool is exposed only when **both** the selected role profile (`full`,
`agent-safe`, `worker`) and the resolved tier allow it; role profile alone is never
authority to expose a higher-tier surface. `tier_visibility` composes with, and does
not replace, `audience`, `recommended_route`, `runtime_posture`, and
`side_effects`.

### Tier resolution is canonical, never caller-asserted

The runtime registered tier is resolved from the canonical CCE/Node Engine
key/no-key posture described by [docs/enforcement-model.md](enforcement-model.md),
`decision`, `decision`, and `decision` — a positively-resolved CCE key
selects the CCE tier; its absence, an unreadable config, or any uncertainty
resolves to free/local. The tier is **never** derived from caller-supplied
request data, prompt text, argv, ambient child env, claimed identity, or ad hoc
local inference. Uncertainty or an invalid CCE-key posture must not expose
higher-tier tools or higher-tier explanatory text.

### Projection is per-tier, and degrades downward

A registration renders only the tool information its resolved tier allows. A
free/local registration receives the free/local base body for every entry it can
see; higher-tier explanatory text, remediation routing, and analysis are not part
of that registered product surface. Where a tier
boundary changes what a route may *say* as well as what it may *run*, the
per-entry metadata carries that distinction — projection never reconstructs it
from caller context.

`workspace_validate_dispatch` and `workspace_agent_dispatch` remain free/local for
dispatch-readiness and launch flow. Validation may refresh only the ignored
current-HEAD graph cache described in
[Discovery Surfaces](tool-discovery-surfaces.md#discovery-surfaces); this cache
write confers no additional authority and does not mutate the carrier.

### Per-tier prose (`tier_text`)

A mixed route that is visible to both tiers carries a free/local base body and
an optional `tier_text.paid_cce` override. Projection strips the internal
`tier_text` container from output, applies the resolved tier's override, and — for
an unknown/absent tier or a missing override — degrades to the free/local base
rather than falling through to higher-tier text.

### `agent-safe` / `agent-authoritative` are not tier labels

`agent-safe` and `agent-authoritative` are compatibility labels for
structured-route/profile routing, not security classifications or product-tier
availability. They may be used only when clearly qualified;
registered-tier metadata remains the sole authority for tier exposure. Do not read
either label as a free-tier availability signal.

MCP runtime exposure is derived from actual registration, the launcher-minted
session role, `session-role-tool-access.json`, the registered tier,
`tier_visibility`, `install_state`, and `runtime_posture`. These are independent
AND gates except that the `operator` role is the declared full-role posture.
The registration boundary also requires a canonical descriptor row with valid
conformance metadata in every tier.

`audience` describes intended consumers for discovery prose. It is not an
exposure, lifecycle, support-state, or authority gate and cannot override any
of the runtime facts above. Caller text, prompt intent, argv, environment,
wrapper names, and inferred defaults likewise cannot widen visibility.

### Terminology disambiguation

Response-shape language such as the code-index compact/degraded/verbose contract is
about payload size, not availability. It is **not** a product tier: do not confuse
a "three response-shape mode" contract with `free_local` / `paid_cce` /
`operator_only` tool exposure.

### Free-tier structured role results under decision

In the free/local tier, `workspace_agent_run_wait` and `workspace_agent_run_status`
can report terminal success while `structured_role_result.valid:false`, because
`decision` free-tier reviewer/redteam/worker output is prose-only and non-attesting.
That value is expected, non-attesting state — not a failed child run, a failed
dispatch, or missing findings. A schema-valid structured role result requires a
configured CCE key.

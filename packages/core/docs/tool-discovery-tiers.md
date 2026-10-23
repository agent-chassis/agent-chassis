# Registered-tier tool exposure

The current [task inventory](mcp-operation-reference.md) is projected through
actual registration, launcher-resolved session role, the central role policy,
registered tier, descriptor `tier_visibility` and install/runtime posture.
Audience prose is descriptive and cannot grant a tool. A role does not acquire
paid capability from a prompt, requested child role or caller tier field.

## Registered tiers

- `free_local`: ordinary local mechanical capability without CCE authority.
- `paid_cce`: paid capability under the serving host's resolved CCE-key posture.
- `operator_only`: independently preserved operator maintenance surfaces.

A free session sees free entries; a paid session may see both free and paid
entries when its role and actual registration permit them. Unknown or absent
classification grants nothing. The server fixes the role/tier tool surface at
startup; changing task text does not re-register tools.

Tier exposure and CCE admission are different. Uncertainty must not expose paid
tools, and a configured unavailable or non-granting CCE must not become a free
admission pass. Only launcher-confirmed no-authority posture supplies local
mechanical operation without a policy decision. See
[enforcement model](enforcement-model.md).

## Authoring and source navigation

| Capability | Free/local | Paid CCE |
| --- | --- | --- |
| `workspace_create_record`, ordinary `save_record` fields | Available to granted roles | Available to granted roles |
| `user_requirements` prose, criteria, validation, exact scopes and slices | Available | Available |
| Controlled `requirements` compilation/retirement and grammar exceptions | Unavailable | Available to granted roles |
| `query_code_index` | Unavailable | Available to granted roles |
| Proof discovery, assessment and supported test/proof execution | Role-granted; capability and bindings still required | Same mechanical owners plus configured policy |
| Reviewer findings | Fixed neutral advisory contract | Advisory findings; CCE intent is independently authenticated |

A refused paid member refuses the entire save before publication; it does not
save ordinary members beside it. No-key status chooses no controlled-acceptance
exemption for the author. An executable implementation contract still needs
complete current controlled acceptance or an explicit author-chosen exemption
with a nonempty rationale.

## Free/local authoring route

For free/local work, use the same record journey:

1. Create with `workspace_create_record`, preserving the user's request in
   `initial.user_requirements`. Read the returned `workspace_read_wiki` call to
   obtain the unit, current combined revision and selected input contract.
2. Inspect source with the family's ordinary repository read/search tools within
   your role entitlement. Do not call the unavailable `query_code_index`, switch
   to an operator CLI as an agent tool, or claim complete graph coverage from a
   text search. Record any missing context or unknown impact.
3. Save prose, exact file scopes, criteria, validation and slices through
   `save_record`. These ordinary fields are free. The unit's selected input
   contract supplies their complete shapes. Keep the behavior-to-evidence mapping
   from the user request even when it is recorded as prose rather than compiled
   requirements.
4. Choose the root work record's controlled-acceptance disposition explicitly.
   An absent disposition is structurally incomplete. The current free authoring
   surface cannot compile new controlled requirements; omitting that member does
   not complete a contract that requires them. When the author decides controlled
   acceptance does not apply and repository policy permits it, use the separate exception
   request below with the root's fresh revision and the author's own rationale.
   The whole-work exemption is stored on the root WK and applies to its slices;
   when acceptance is required, each selected slice needs its own obligations.
   Do not infer an exemption from the tier or write an `opted_out` ordinary change.
5. Assess the selected slice with `workspace_assess_contract`, inspect its actual
   diagnostics, and compare its prose contract with the complete user request.
   Start only the exact authored slice through `start_agent` when authorized.
   A valid exemption records no controlled proof credit and does not waive tests,
   review, CCE policy or repository conduct requirements.

The exception request is a template, not an executed example or a recommendation
to exempt any particular work:

```text
save_record({
  unit: <root-WK>,
  revision: <root-current-revision>,
  exception: {
    kind: "controlled_acceptance", action: "apply",
    subject: <root-WK>, rationale: <author-chosen-nonempty-rationale>
  }
})
```

Read the known root's exception grammar directly with
`workspace_read_wiki({reads:[{subject:<root-WK>,select:{input_contract:{tool:"save_record",operation:"exception"}}}]})`.
Request context only when the root or needed selection is unknown.
The rationale is recorded as written and is not assessed for eligibility. If
repository policy requires compiled requirements for this work and does not
permit an exemption, report that exact authority/capability mismatch; do not
silently narrow the contract or invent a free compiler route.

## Review and result posture

`start_agent` and `get_run_result` are the public start/result tools. Historical
`workspace_agent_dispatch`, `workspace_agent_run_status` and
`workspace_validate_dispatch` are not aliases. A preview checks only the facts
it reports and establishes no runtime admission or successful child launch.

Reviewer and standalone redteam output remains advisory text; schema diagnostics
concern only separately requested formal attestation. Findings do not veto or
authorize a corrective dispatch. Standalone redteam requires its exact canonical
adversarial unit; the free launcher provides no caller-selected reviewer mode.
Integration is an explicit coordinator request under mechanical identity checks
and any configured CCE policy, not a side effect of result observation.

Per-tier prose must describe the capability actually served. Paid-only
explanations or recovery routes must not appear as mandatory free instructions.
Payload-size modes and lexical match tiers are unrelated to product availability.

Paid code queries and requirement editing require a compatible private package
in the serving installation. Installation grants no access; CCE and role/tier
restrictions remain authoritative. Free sessions need no private package.

A missing or invalid provider refuses paid startup before readiness with its
specific mechanical diagnosis. Correct the serving installation and restart.
See [paid capability availability and recovery](paid-library-composition.md).
Detailed implementation documentation accompanies the private package.


# Launcher Policy Profiles and Dispatch-Readiness Thresholds

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents optional launcher policy inputs: the CCE / Chassis Control
Engine org policy profile and the local source-available policy-pack override
file. The org profile is an authority-bearing CCE-path input. The local
source-available file is inert for admissibility thresholds and verdicts after
decision; it is retained only as local config/evidence hygiene.

## Policy scope

These policy inputs tune and record admissibility thresholds; they enforce
product contracts and preserve provenance, and they do not claim security
against a hostile same-user actor or a compromised host. The org policy profile
is authority-bearing only on the CCE-bound path, where the Chassis Control
Engine owns thresholds and verdicts; the local source-available override file is
inert for admissibility. Both assume an honest operator and honest
launcher-minted runtime: their job is to keep an honest dispatch's reviewability
tuning correct and legible, not to withstand a local actor who already controls
the account or the workspace.

The following remain real boundaries and are unchanged by that scope framing:

- **Node Engine / CCE admission authority.** On the CCE-bound path the Chassis
  Control Engine is the sole admissibility authority; a declared-but-malformed
  org profile fails closed rather than silently falling back to defaults.
- **Launcher-owned, workspace-local config.** The profile is launcher/operator
  config read from `<workspace>/.agent-launch/`, never selected by prompt,
  request payload, argv, or agent-authored env.
- **Fail-closed config hygiene.** A declared-but-malformed local override fails
  closed with diagnostics to protect evidence integrity; that is corruption
  detection, not a local admissibility verdict.

For the durable audit and honest-scope mandate behind this framing, see
agent-chassis:work record.

## Org policy profile (optional)

By default the launcher transmits **no** org policy profile, so the Chassis
Control Engine uses the active ratified pack's built-in thresholds. To use
org-tuned thresholds, place a profile at
`<workspace>/.agent-launch/org-policy-profile.json`.
Copy the committed `org-policy-profile.example.json` to that path, then tune the
workspace-local copy.

This file is **optional** and **workspace-local** — `.agent-launch/` is
git-ignored, so it does not travel with the repo and each workspace sets its own.
It only takes effect on the **Chassis Control Engine-bound path** (an API key plus a
ratified `NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST`); on the free /
local-only path it is inert. A *declared-but-malformed* profile **fails closed**
on the CCE path (it never silently falls back to defaults).

The profile is **all-or-nothing**: a single `{ "parameter_values": { … } }`
object carrying the **complete** parameter set for the active ratified Node
Engine pack. For each control that set includes a `<control>.review_threshold`
and `<control>.waiver_allowability`; controls with a hard-reject band also carry
`<control>.deny_threshold`. A sparse or differently-shaped file is rejected;
there is no partial-override form.

The LOC controls include:

- `write_scope_total_loc.review_threshold`
- `write_scope_total_loc.deny_threshold`
- `max_write_file_loc.review_threshold`
- `max_write_file_loc.deny_threshold`
- `expected_changed_line_budget.review_threshold`, the current small-edit budget
  control

Every numerical value is supplied by the active org policy / ratified Node
Engine pack. None is a Portfolio architecture constant. In particular,
`max_write_file_loc.deny_threshold` is part of that complete authority-bearing
parameter set; this page does not declare it permanently fixed or independently
enforced by Portfolio. The committed `org-policy-profile.example.json` is a
configuration-shape example and point-in-time input template, not authority for
the active values. Before using a workspace-local copy, populate its complete
parameter set from the active ratified pack rather than treating the example's
numbers as universal defaults.

See `docs/enforcement-model.md` → "Org policy-profile carrier" for the carrier
contract and the per-tier (CCE fail-closed / free inert) posture.

## Local source-available policy-pack override file (optional)

The local/source-available path may contain a repo-local override file:

```text
wiki/.worker-admission-policy-pack-override.json
```

This is distinct from the hosted Chassis Control Engine org policy profile above. The
Chassis Control Engine profile is workspace-local CCE-path input under `.agent-launch/`
and is inert on the free/local path; the source-available override is
portfolio-local config/evidence kept in the repo's `wiki/` tree and is inert for
dispatch-readiness admissibility thresholds. A missing override file means no
local override evidence is present.

The override file is recognized by this schema version:

```json
{
  "schema_version": "worker-admission-policy-pack-override.v1"
}
```

The local reader may still validate the file as configuration evidence. A
declared-but-malformed local override fails closed with diagnostics for hygiene
problems such as malformed JSON/config, unsupported schema versions, unknown
entries, invalid values, or contradictory disabled-rule declarations. That
fail-closed behavior protects evidence integrity only; it is not local threshold
authority and does not produce a local admissibility verdict.

After decision, the local side measures and forwards raw carrier facts over the
unchanged `worker_admission_v1` request shape and interprets Chassis Control
Engine-returned verdicts and reason codes. It does not apply local review
thresholds, local deny boundaries, production rule ids, or local advisory
admissibility codes. On the free/local-only path, the local policy pack remains
inert for admissibility; on the CCE path, Chassis Control Engine owns thresholds
and verdicts.

Non-blocking follow-up: if CLI-forwarding docs or tests still describe
local-only behavior as an advisory policy-pack verdict, update that wording in
the owning CLI-forwarding slice to say the local path reports no pack-backed
admissibility verdict.

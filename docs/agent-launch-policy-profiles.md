
# Launcher Policy Profiles and Dispatch-Readiness Thresholds

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents optional launcher policy inputs: the CCE / Chassis Control
Engine org policy profile and the local source-available policy-pack override
file. The org profile is an authority-bearing CCE-path input. The local
source-available file is inert for admissibility thresholds and verdicts after
decision; it is retained only as local config/evidence hygiene.

## Org policy profile (optional)

By default the launcher transmits **no** org policy profile, so the Chassis Control Engine uses its built-in default thresholds. To use org-tuned
thresholds, place a profile at `<workspace>/.agent-launch/org-policy-profile.json`.
Copy the committed `org-policy-profile.example.json` to that path, then tune the
workspace-local copy.

This file is **optional** and **workspace-local** — `.agent-launch/` is
git-ignored, so it does not travel with the repo and each workspace sets its own.
It only takes effect on the **Chassis Control Engine-bound path** (an API key plus a
ratified `NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST`); on the free /
local-only path it is inert. A *declared-but-malformed* profile **fails closed**
on the CCE path (it never silently falls back to defaults).

The profile is **all-or-nothing**: a single `{ "parameter_values": { … } }`
object carrying the **complete** set of 19 dotted keys — for each of the 8
controls a `<control>.review_threshold` and a `<control>.waiver_allowability`,
plus a `<control>.deny_threshold` for `write_scope_count`, `write_scope_total_loc`,
and the fixed `max_write_file_loc` non-launchable carrier value. A sparse or
differently-shaped file is rejected; there is no partial-override form. Start
from the Chassis Control Engine default baseline below and tune the reviewability thresholds
from there (for example, raise `write_scope_total_loc.review_threshold` above 200
so larger edits dispatch without review pressure). `max_write_file_loc.deny_threshold`
is not a tuning knob; it remains fixed at the current worker-admission
policy's 1200 LOC non-launchable threshold.

```json
{
  "parameter_values": {
    "write_scope_count.review_threshold": 1,
    "write_scope_count.deny_threshold": 4,
    "write_scope_count.waiver_allowability": ["reviewer_attestation"],
    "write_scope_total_loc.review_threshold": 200,
    "write_scope_total_loc.deny_threshold": 1200,
    "write_scope_total_loc.waiver_allowability": ["accepted_authority", "reviewer_attestation"],
    "max_write_file_loc.review_threshold": 600,
    "max_write_file_loc.deny_threshold": 1200,
    "max_write_file_loc.waiver_allowability": ["accepted_authority", "reviewer_attestation"],
    "acceptance_criteria_count.review_threshold": 10,
    "acceptance_criteria_count.waiver_allowability": ["reviewer_attestation"],
    "validation_command_count.review_threshold": 2,
    "validation_command_count.waiver_allowability": ["reviewer_attestation"],
    "expected_changed_line_budget.review_threshold": 200,
    "expected_changed_line_budget.waiver_allowability": ["reviewer_attestation"],
    "declared_runtime_mode_count.review_threshold": 1,
    "declared_runtime_mode_count.waiver_allowability": ["reviewer_attestation"],
    "artifact_kind_count.review_threshold": 1,
    "artifact_kind_count.waiver_allowability": ["reviewer_attestation"]
  }
}
```

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

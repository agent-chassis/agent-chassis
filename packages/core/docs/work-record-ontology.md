
# Work-record ontology: authored vs derived vocabularies

This page is the external-facing reference for the controlled vocabularies in the
work-record model: what each one is, **who supplies it** (an authoring agent, the
tooling, or operator config), and **what reads it** (a
validation/dispatch-readiness gate that *enforces* it, versus a
renderer/index/analysis layer that only *describes* it).

It complements, and does not duplicate, the public contract sources:
`packages/wiki-core/contract/schema.md` describes the shared schema surface, and
`packages/wiki-core/contract/manifest.json` is the versioned contract manifest.
Use those contract files and the shipped wiki-core schema implementation as the
authority for exact allowed values and validation behavior.

## Why this page exists

The schema has enough controlled vocabularies that, read as a flat list, the
surface can look like a large authoring burden. A common outside reaction is
"collapse the ontology to a handful of enforcement fields." That reaction
**miscounts a derived analysis layer as agent burden**.

The load-bearing distinction is *authored vs derived*:

- The surface an authoring agent actually fills in **per task is small**.
- The heavy tier — the `WORK_UNIT_FEATURE_VECTOR_*` family — is **fully
  tooling-derived**, lives in a **separate schema** (`work-unit-feature-vector.v1`
  / `wk-ontology.v1`, not the canonical `work-record.v1`), and is **never required
  from an authoring agent** at record-author or dispatch-readiness time. A
  normalizer computes it from the record's shape, write scope, and graph evidence,
  tagging each value's `facet_provenance`.

So the per-task authoring cost is already close to the "minimal enforcement set"
an outside reviewer would propose; the rest is either computed for you or only
appears on rare exception paths. See [Rejected approach](#rejected-approach-collapse-the-ontology).

This is an ergonomics and legibility reference. The contract files and wiki-core
implementation remain the schema authority.

## Reading the tables

- **Supplied by** — `authored` (an agent/coordinator writes it into a canonical
  record), `derived` (tooling computes it), or `config` (chosen by a
  renderer/operator).
- **Read by** — `ENFORCES` means a validation/dispatch-readiness/dispatch path
  branches or rejects on the value; `DESCRIBES` means a renderer, catalog/index, or
  analysis-only consumer reads it without gating.

## Tier 1 — Agent-authored, every task

This is the normal per-task authoring surface for controlled vocabularies.

| Vocabulary | Field | Supplied by | Read by |
|---|---|---|---|
| `record_kind` | top-level | authored | ENFORCES at the work-record schema boundary |
| `work_kind` | top-level / child / slice | authored | ENFORCES at the work-unit schema boundary; drives lifecycle gates |
| `status` | top-level / child / slice | authored | ENFORCES at schema and status-transition boundaries |
| `priority` | top-level | authored | DESCRIBES urgency; downstream lint/render policy may constrain values |
| `dispatch_intent.target_unit` | `dispatch_intent` | authored | ENFORCES dispatch target shape |
| `dispatch_intent.intended_agent_role` | `dispatch_intent` | authored | ENFORCES dispatch role shape |

## Tier 2 — Authored, but only on exception paths

These are real authoring fields, but an agent encounters them **only** when
escalating or migrating — not on a normal task.

| Vocabulary | Field | Supplied by | Read by |
|---|---|---|---|
| `escalation.kind` | `escalations[].kind` | authored (escalation only) | ENFORCES escalation shape |
| `escalation.status` | `escalations[].status` | authored or transitioned (escalation only) | ENFORCES escalation lifecycle |
| escalation provenance `source_kind` | `escalations[].provenance` | authored, **required** (escalation only) | ENFORCES escalation evidence shape |
| escalation provenance `canonicality` | `escalations[].provenance` | authored, **required** (escalation only) | ENFORCES escalation evidence shape |
| escalation provenance `evidence_basis` | `escalations[].provenance` | authored, **required** (escalation only) | ENFORCES escalation evidence shape |
| `migration.review_state` | `migration` | authored (migration records only) | ENFORCES migration review shape |

## Tier 3 — Tooling-derived or config (no per-task authoring burden)

None of these is supplied by an authoring agent. The feature-vector family is the
tier most often mistaken for authoring burden; it is computed by
`normalizeWorkUnitFeatureVector` (`work-record-feature-vector.mjs`) and stored in
the separate `work-unit-feature-vector.v1` schema.

| Vocabulary | Lives in | Supplied by | Read by |
|---|---|---|---|
| `activity_kind` | `work-unit-feature-vector.v1` | derived (normalizer) | ENFORCES at schema boundary; DESCRIBES in clustering/dispatch analysis |
| `artifact_kind` | `work-unit-feature-vector.v1` | derived (from write scope / tests) | same as above |
| `operation` | `work-unit-feature-vector.v1` | derived (from write scope) | same as above |
| `granularity` | `work-unit-feature-vector.v1` | derived (from parsed paths) | same as above |
| `verification_method` | `work-unit-feature-vector.v1` | derived (from acceptance / validation evidence) | same as above |
| `scenario_kind` | `work-unit-feature-vector.v1` | derived (from acceptance / graph) | same as above |
| feature-vector `runtime_mode` | `work-unit-feature-vector.v1` | derived (from policy context) | same as above |
| `facet_provenance` | `work-unit-feature-vector.v1` | derived (tags each value's source) | ENFORCES at schema boundary; DESCRIBES for audit |
| `work_report.status` | `work-report.v1` (role result) | derived (emitted by a role) | ENFORCES on the report |
| `work_report.validation_status` | `work-report.v1` (role result) | derived (emitted by a role) | ENFORCES on the report |
| `diagnostic_codes` | validation output | derived (emitted by validators) | DESCRIBES — never authored |
| `derived_evidence_decision_kind` | dispatch-readiness evidence | derived (dispatch-readiness tooling) | ENFORCES on the evidence object |
| `projection_kind` | canonical `projections[]` | config (renderer-chosen) | ENFORCES at the renderer boundary |

## Rejected approach: collapse the ontology

> "Keep only fields required for enforcement (subject, scope, role, validation,
> provenance, result) and let the agent infer the rest."

Rejected, because the premise does not hold once authored and derived are
separated:

1. **The authoring surface is already minimal.** Per the tables above, the
   per-task authored vocabulary is small — already close to the "minimal
   enforcement set" the proposal asks for. The escalation-provenance fields are
   the only other authored vocabularies, and they appear only when escalating.
2. **The heavy tier is derived, not authored.** The `WORK_UNIT_FEATURE_VECTOR_*`
   family is computed by the normalizer and lives in a separate schema; no path
   ever requires an agent to supply it. Collapsing it removes no agent burden —
   the burden was never there.
3. **What collapse would actually buy** is reduced maintainer/implementation
   complexity in the derived analysis layer, which is a legitimate but different
   goal, not an agent-ergonomics win. Any such change belongs in a decision
   record, weighed against the repo's stated intent to build the real substrate
   rather than a thin subset (see `AGENTS.md`, *Scope And Ambition*).

The right remedy for "the ontology looks heavy" is **legibility** — this page —
not removal.

## Known follow-up

`priority` is declared as an enum in `packages/wiki-core/contract/manifest.json`,
but wiki-core validation may be broader than the manifest-facing contract.
Aligning core validation with the manifest enum is a small, separate work item.

## See also

- `packages/wiki-core/contract/schema.md` — public shared schema contract.
- `packages/wiki-core/contract/manifest.json` — versioned contract manifest.
- `packages/wiki-core/src/lib/work-record-schema-constants.mjs` — shipped
  implementation constants for exact vocabulary values.
- `packages/wiki-core/src/lib/work-record-feature-vector.mjs` — the normalizer
  that derives the feature-vector tier.

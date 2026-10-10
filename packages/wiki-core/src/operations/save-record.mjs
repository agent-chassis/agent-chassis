

import { controlledContractContentDigest } from "../lib/controlled-contract-tools.mjs";
import { today } from "../lib/wiki-shared.mjs";
import { computeWorkRecordSourceDigest } from "../lib/work-record-schema.mjs";
import { loadControlledContractProofAuthoring } from "./controlled-contract/package-runtime.mjs";
import { bindProofAuthoringRevision } from "./controlled-contract/proof-authoring-revision.mjs";
import { resolveProofAuthoringSource } from "./controlled-contract/proof-authoring-source.mjs";
import { settlePreparedRecordAuthoring } from "./controlled-contract/proof-authoring-targets.mjs";
import { captureProofAssessmentOperation } from "./controlled-contract/proof-validation-operations.mjs";
import { parseProofSourceUnitAddress } from "./controlled-contract/saved-proof-source.mjs";
import { editKindRecord } from "./kind-record-edit.mjs";
import { inspectRecordAuthoringInitiative, planKindRecordAuthoringChange, prepareRecordAuthoringChange } from "./record-authoring-plan.mjs";

export const SAVE_RECORD_RESULT_SCHEMA_VERSION = "save-record-result.v1";
const KIND_RECORD_UNIT = /^(?:IN|DEC)-[0-9]{4}$/u;
const WORK_ITEM_UNIT = /^WK-[0-9]{4,}(?:#.+)?$/u;

const NOT_CAUSED = Object.freeze({ proofs_executed: false, agent_started: false,
  delivery_integrated: false, landing_established: false });

const result = (fields) => ({ schema_version: SAVE_RECORD_RESULT_SCHEMA_VERSION, ...fields });
const refused = ({ unit, revision = null, diagnostics }) => result({ outcome: "refused", unit,
  revision, diagnostics, effects: { published: false, ...NOT_CAUSED } });
const diagnostic = (code, path, message, extra = {}) => ({ code, severity: "error", path, message, ...extra });

const publishedOwnerDetails = (value, guidanceCall) => Array.isArray(value)
  ? value.map((member) => publishedOwnerDetails(member, guidanceCall))
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).flatMap(([key, member]) => {
      if (key !== "guidance_path") return [[key, publishedOwnerDetails(member, guidanceCall)]];
      const call = guidanceCall?.(member) ?? null;
      return call === null ? [] : [["guidance_call", call]];
    }))
    : value;

function failureEffects(error) {
  const details = error?.details ?? {};
  if (details.publication_outcome === "established" || details.changed === true) {
    return { published: true, retry_safe: false,
      publication_phase: details.publication_phase ?? "post_commit" };
  }
  if (details.settlement_status === "compensated" || details.changed === false) {
    return { published: false, compensated: details.settlement_status === "compensated" };
  }
  return { published: "unknown", retry_safe: details.retry_safe ?? false,
    commit_state: details.commit_state ?? "indeterminate" };
}

const digest = (value) => value === null || value === undefined ? null : controlledContractContentDigest(value);

function publishedEffects(initial, snapshot) {
  const before = new Map(initial.sources.map((entry) => [entry.selectedUnit, entry.source?.content_digest ?? null]));
  const sources = snapshot.sources.filter((entry) =>
    (entry.source?.content_digest ?? null) !== before.get(entry.selectedUnit))
    .map((entry) => entry.selectedUnit === null ? snapshot.wkId : `${snapshot.wkId}#${entry.selectedUnit}`);
  return { published: true,
    record_written: digest(initial.record) !== digest(snapshot.record),
    semantic_sources_written: sources,
    contract_written: digest(initial.contract?.content) !== digest(snapshot.contract?.content) };
}

async function saveWorkItem({ repoRoot, unit, revision, changes }, options) {
  const { wkId, selectedUnit } = parseProofSourceUnitAddress(unit);
  const target = { repoRoot, wkId, focus: null, selectedUnit };
  const pkg = await loadControlledContractProofAuthoring();
  const initial = await bindProofAuthoringRevision(
    await (options.resolveFacts ?? resolveProofAuthoringSource)(target));
  if (revision !== initial.authoringIdentity) {
    return refused({ unit, revision: initial.authoringIdentity, diagnostics: [diagnostic(
      "save_record_revision_stale", "revision",
      "revision is not the current revision of this unit; read the unit again and save against the revision it returns")] });
  }

  const initiativeDiagnostics = await inspectRecordAuthoringInitiative({ repoRoot: initial.repoRoot, changes });
  if (initiativeDiagnostics.length) return refused({ unit, revision, diagnostics: initiativeDiagnostics });
  let plan;
  try {
    plan = await prepareRecordAuthoringChange({ capturedSource: initial, changes,
      owners: { pkg, now: options.now ?? today, repository: options.repository ?? null,
        resolveExternalReference: options.resolveExternalReference ?? null,
        resolveRetainedGraphEvidence: options.resolveRetainedGraphEvidence ?? null } });
  } catch (error) {

    if (typeof error?.code !== "string" || error.details?.changed !== false) throw error;
    return refused({ unit, revision, diagnostics: [diagnostic(error.code,
      typeof error.details.path === "string" && error.details.path.startsWith("changes") ? error.details.path : "changes", error.message,
      { details: publishedOwnerDetails(error.details, options.requirementGuidanceCall),
        correction: "Correct the addressed changes using the owner details and save against the current revision." })] });
  }
  if (!plan.ok) return refused({ unit, revision, diagnostics: plan.diagnostics });

  const assessCommitted = snapshot => observeRecordAuthoringAssessment({ ...target, repoRoot: initial.repoRoot }, snapshot, options);
  let settled;
  try {
    settled = await settlePreparedRecordAuthoring({ input: { ...target, repoRoot: initial.repoRoot }, initial,
      preparation: plan.preparation, options: { ...options, observeCommitted: assessCommitted } });
  } catch (error) {
    if (error?.code === "obligation_coverage_final_compare_stale") {
      return refused({ unit, diagnostics: [diagnostic("save_record_revision_stale", "revision",
        "the unit changed after this save was prepared; nothing was published")] });
    }
    error.save_record = { unit, prior_revision: revision, effects: { ...failureEffects(error), ...NOT_CAUSED } };
    throw error;
  }
  const { assessment_carrier: carrier, ...assessed } = settled.observed;
  const saved = result({ outcome: settled.no_op ? "no_op" : "saved", unit, kind: "work_item",
    prior_revision: revision, revision: settled.snapshot.authoringIdentity,
    record_source_digest: computeWorkRecordSourceDigest(settled.snapshot.record),
    bindings: plan.bindings, criterion_identity_changes: plan.criterion_identity_changes,
    entries: plan.entries,
    ready_slices: plan.ready_slices,
    changed_fields: settled.no_op ? [] : plan.changed_fields,
    ...(settled.receipt?.terminal_receipt?.ok === false ? { persistence: settled.receipt.terminal_receipt } : {}),
    effects: { ...(settled.no_op ? { published: false } : publishedEffects(initial, settled.snapshot)),
      ...NOT_CAUSED }, ...assessed });
  if (carrier !== undefined) Object.defineProperty(saved, "assessment_carrier", { value: carrier, enumerable: false });
  return saved;
}

export async function observeRecordAuthoringAssessment({ repoRoot, wkId, selectedUnit = null, focus = null }, snapshot, options = {}) {
    try {
      const assessed = await (options.assess ?? captureProofAssessmentOperation)(
        { repoRoot, wkId, selectedUnit, focus });
      if (assessed.assessment === null) return { assessment: null };
      if ((assessed.assessment?.content_digest ?? null) !== snapshot.revision) {
        return { assessment: null, assessment_unavailable: { code: "save_record_assessment_source_mismatch",
          message: "the assessment did not observe the source this save left; it is not this save's assessment",
          saved_source: snapshot.revision, assessed_source: assessed.assessment?.content_digest ?? null } };
      }
      const { assessment, ...beside } = assessed;
      return { assessment, assessed_source: snapshot.revision, assessment_carrier: beside };
    } catch (error) {
      return { assessment: null, assessment_unavailable: { code: error?.code ?? "save_record_assessment_failed",
        message: error?.message ?? "the same-source assessment could not be computed" } };
    }
}

async function saveKindRecord({ repoRoot, unit, revision, changes }, options) {
  let plan = null;
  const edited = await editKindRecord({ repoRoot, id: unit, expectedSourceDigest: revision,
    applyPlan: (record, actor, now) => (plan = planKindRecordAuthoringChange({ record, changes, actor,
      now: options.now?.() ?? now })) });
  if (!edited.ok) {
    const mechanical = edited.diagnostics.find(entry => entry.code === "kind_record_write_failed");
    if (mechanical) {
      const error = Object.assign(new Error(mechanical.message, { cause: mechanical.cause }), {
        code: mechanical.code,
        save_record: { unit, prior_revision: revision, persistence: edited,
          effects: { published: edited.written === null ? "unknown" : edited.written,
            record_written: edited.written, retry_safe: false, ...NOT_CAUSED } }
      });
      throw error;
    }
    const stale = edited.diagnostics.some(entry => entry.code === "stale_source_digest");
    return refused({ unit, revision: stale ? edited.current_source_digest ?? edited.source_digest ?? null : revision,
      diagnostics: stale ? [diagnostic("save_record_revision_stale", "revision",
        "revision is not the current revision of this unit; read the unit again and save against the revision it returns")]
        : edited.diagnostics });
  }
  return result({ outcome: edited.written ? "saved" : "no_op", unit, kind: edited.record.record_kind,
    prior_revision: revision, revision: edited.source_digest, bindings: {}, criterion_identity_changes: [],
    changed_fields: edited.written ? plan.changedFields : [],
    effects: { published: edited.written, record_written: edited.written, ...NOT_CAUSED },
    assessment: null });
}

export async function saveRecord({ repoRoot, unit, revision, changes } = {}, options = {}) {
  if (typeof unit !== "string" || typeof revision !== "string" || revision.length === 0) {
    return refused({ unit: typeof unit === "string" ? unit : null, diagnostics: [diagnostic(
      "save_record_request_invalid", typeof unit === "string" ? "revision" : "unit",
      "save_record takes an existing unit and the revision last read for it")] });
  }
  if (WORK_ITEM_UNIT.test(unit)) return saveWorkItem({ repoRoot, unit, revision, changes }, options);
  if (KIND_RECORD_UNIT.test(unit)) return saveKindRecord({ repoRoot, unit, revision, changes }, options);
  return refused({ unit, diagnostics: [diagnostic("save_record_unit_unsupported", "unit",
    "unit must name an existing work record, slice, initiative or decision of the current repository")] });
}

export async function readRecordAuthoringRevision({ repoRoot, unit }) {
  if (KIND_RECORD_UNIT.test(unit)) {
    const { loadKindRecordById } = await import("../lib/kind-record-store.mjs");
    return (await loadKindRecordById({ repoRoot, id: unit })).source_digest ?? null;
  }
  const { wkId, selectedUnit } = parseProofSourceUnitAddress(unit);
  return (await bindProofAuthoringRevision(await resolveProofAuthoringSource(
    { repoRoot, wkId, focus: null, selectedUnit }))).authoringIdentity;
}

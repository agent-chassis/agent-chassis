

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
import { inspectRecordAuthoringInitiative, planKindRecordAuthoringChange, prepareRecordAuthoringChange,
  prepareRecordAuthoringException } from "./record-authoring-plan.mjs";
import { RECORD_AUTHORING_EXCEPTION_CODES } from "../lib/record-authoring-exception.mjs";
import { validateRecordAuthoringChanges } from '../lib/record-authoring-schema.mjs';
import { PROOF_REFRESH_CORRECTION } from './controlled-contract/proof-authoring-refresh.mjs';
import { proofRefreshRecovery } from '../lib/proof-refresh-guidance.mjs';
import { authoredSaveRecordScopes } from '../lib/work-record-save-scope.mjs';
import { SidecarPathValidationError } from '../lib/sidecar-paths.mjs';

export const SAVE_RECORD_RESULT_SCHEMA_VERSION = "save-record-result.v1";
const KIND_RECORD_UNIT = /^(?:IN|DEC)-[0-9]{4}$/u;
const WORK_ITEM_UNIT = /^WK-[0-9]{4,}(?:#.+)?$/u;

const NOT_CAUSED = Object.freeze({ proofs_executed: false, agent_started: false,
  delivery_integrated: false, landing_established: false });

const result = (fields) => ({ schema_version: SAVE_RECORD_RESULT_SCHEMA_VERSION, ...fields });
const refused = ({ unit, revision = null, diagnostics, effects = { published: false } }) => result({ outcome: "refused", unit,
  revision, diagnostics, effects: { ...effects, ...NOT_CAUSED } });
const diagnostic = (code, path, message, extra = {}) => ({ code, severity: "error", path, message, ...extra });

function authoredIdentityPaths(value, rejectedPath, at = 'changes') {
  if (value === null || typeof value !== 'object') return [];
  if (['repository_path', 'code_symbol'].includes(value.kind) && value.path === rejectedPath) return [`${at}.path`];
  return Object.entries(value).flatMap(([key, child]) => authoredIdentityPaths(child, rejectedPath,
    Array.isArray(value) ? `${at}[${key}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
      ? `${at}.${key}` : `${at}[${JSON.stringify(key)}]`));
}

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

async function saveWorkItem({ repoRoot, unit, revision, changes, exception }, options) {
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

  const initiativeDiagnostics = exception !== undefined ? []
    : await inspectRecordAuthoringInitiative({ repoRoot: initial.repoRoot, changes });
  if (initiativeDiagnostics.length) return refused({ unit, revision, diagnostics: initiativeDiagnostics });

  const owners = { pkg, now: options.now ?? today, repository: options.repository ?? null,
    registeredTier: options.registeredTier ?? null,
    requirementAuthoring: options.requirementAuthoring,
    resolveExternalReference: options.resolveExternalReference ?? null,
    resolveRetainedGraphEvidence: options.resolveRetainedGraphEvidence ?? null };
  let plan;
  try {

    plan = exception !== undefined
      ? await prepareRecordAuthoringException({ capturedSource: initial, exception, owners })
      : await prepareRecordAuthoringChange({ capturedSource: initial, changes, owners });
  } catch (error) {
    if (error instanceof SidecarPathValidationError && changes !== undefined) {
      const fields = authoredIdentityPaths(changes, error.inputPath);
      if (fields.length > 0) return refused({ unit, revision, diagnostics: [diagnostic(error.code,
        fields[0], error.message, { details: { subject: error.inputPath,
          ...(fields.length === 1 ? {} : { additional_authored_fields: fields.slice(1) }),
          ...(error.reason === undefined ? {} : { reason: error.reason }) },
          correction: 'Nothing was saved. Correct the addressed source identity only if mistaken; preserve the intended meaning and other changes. Otherwise stop: access to that source is refused.' })] });
    }

    if (typeof error?.code !== "string" || error.details?.changed !== false) throw error;
    if (error.code === 'obligation_coverage_prospective_incompatible' && changes?.refresh_proofs !== true &&
        error.details.causes?.some(cause => cause.code === 'obligation_coverage_definition_integrity_mismatch')) {
      error.details = { ...error.details, refresh_recovery: {
        condition: 'Exact selected definitions must be available and unchanged authored inputs compatible across the whole WK.',
        ...proofRefreshRecovery(wkId) } };
    }
    const root = exception !== undefined ? "exception" : "changes";
    return refused({ unit, revision, diagnostics: [diagnostic(error.code,
      typeof error.details.field === "string" && error.details.field.startsWith(root) ? error.details.field
        : typeof error.details.path === "string" && error.details.path.startsWith(root) ? error.details.path : root, error.message,
      { details: publishedOwnerDetails(error.details, options.requirementGuidanceCall),
        correction: exception !== undefined
          ? "Nothing was saved. Correct the addressed exception using the owner details and request it against the current revision."
          : changes.refresh_proofs === true ? PROOF_REFRESH_CORRECTION
            : "Correct the addressed changes using the owner details and save against the current revision." })] });
  }
  if (!plan.ok) return refused({ unit, revision, diagnostics: plan.diagnostics });

  if (changes !== undefined) {
    const targets = authoredSaveRecordScopes({ record: plan.record, previousRecord: initial.record,
      selectedUnit, changes, bindings: plan.bindings });
    if (targets.length) {
      const diagnostics = typeof options.validateScopes === 'function'
        ? await options.validateScopes({ repoRoot: initial.repoRoot, record: plan.record, targets })
        : [diagnostic('save_record_scope_not_evaluated', targets[0].inputPath,
          'Scope paths were not checked: the host did not compose the worker scope validation owner',
          { correction: 'Nothing was saved. Use a save_record host with the repository/base scope validator composed, then retry.' })];
      if (diagnostics.length) return refused({ unit, revision, diagnostics });
    }
  }

  const assessCommitted = snapshot => observeRecordAuthoringAssessment({ ...target, repoRoot: initial.repoRoot }, snapshot, options);
  let settled;
  try {
    settled = await settlePreparedRecordAuthoring({ input: { ...target, repoRoot: initial.repoRoot }, initial,
      preparation: plan.preparation, options: { ...options, observeCommitted: assessCommitted } });
  } catch (error) {
    const effects = failureEffects(error);
    if (error?.code === "obligation_coverage_final_compare_stale" && effects.published === false) {
      return refused({ unit, effects, diagnostics: [diagnostic(error.details?.movement === 'revision'
        ? 'save_record_revision_stale' : error.code, error.details?.movement === 'revision' ? 'revision' : 'changes',
        error.message, { details: publishedOwnerDetails({ ...error.details,
          next_calls: [{ tool: 'workspace_read_wiki', arguments: { reads: [{ subject: unit, ...(changes === undefined ? {} : { for_changes: Object.keys(changes) }) }] } }] }, options.requirementGuidanceCall),
          effects, correction: 'Read the unit again to inspect current state; do not reuse the failed request revision.' })] });
    }
    error.save_record = { unit, prior_revision: revision, effects: { ...effects, ...NOT_CAUSED },
      ...(effects.published === true ? { kind: 'work_item', bindings: plan.bindings, requirement_rows: plan.requirement_rows, entries: plan.entries,
        criterion_identity_changes: plan.criterion_identity_changes } : {}),
      failure: publishedOwnerDetails(error.details ?? {}, options.requirementGuidanceCall),
      ...(effects.published === 'unknown' ? { recovery: {
        responsible_owner: 'controlled_contract_authoring_settlement',
        missing_capability: 'Outcome reconciliation is unavailable through save_record; inspect the failure and current root state without replaying the mutation.' } } : {}) };
    throw error;
  }
  const { assessment_carrier: carrier, ...assessed } = settled.observed;
  const saved = result({ outcome: settled.no_op ? "no_op" : "saved", unit, kind: "work_item",
    prior_revision: revision, revision: settled.snapshot.authoringIdentity,
    record_source_digest: computeWorkRecordSourceDigest(settled.snapshot.record),
    bindings: plan.bindings, criterion_identity_changes: plan.criterion_identity_changes,
    ...(plan.requirement_rows === null || plan.requirement_rows === undefined ? {} : { requirement_rows: plan.requirement_rows }),
    entries: plan.entries,
    ready_slices: plan.ready_slices,
    ...(plan.preparation.refresh === undefined ? {} : { refresh: plan.preparation.refresh }),
    ...(plan.exception === undefined ? {} : { exception: plan.exception }),
    changed_fields: settled.no_op ? [] : plan.changed_fields,
    ...(settled.receipt?.terminal_receipt?.ok === false ? { persistence: settled.receipt.terminal_receipt } : {}),
    effects: { ...(settled.no_op ? { published: false, ...(plan.preparation.refresh === undefined ? {} : {
      record_written: false, contract_written: false, semantic_sources_written: [] }) } : publishedEffects(initial, settled.snapshot)),
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

export async function saveRecord({ repoRoot, unit, revision, changes, exception } = {}, options = {}) {
  if (typeof unit !== "string" || typeof revision !== "string" || revision.length === 0) {
    return refused({ unit: typeof unit === "string" ? unit : null, diagnostics: [diagnostic(
      "save_record_request_invalid", typeof unit === "string" ? "revision" : "unit",
      "save_record takes an existing unit and the revision last read for it")] });
  }

  if (exception !== undefined && changes !== undefined) {
    return refused({ unit, diagnostics: [diagnostic("save_record_request_invalid", "exception",
      "a save carries changes or one exception, never both")] });
  }
  if (changes !== null && typeof changes === 'object' && Object.hasOwn(changes, 'refresh_proofs')) {
    const root = /^WK-[0-9]{4,}$/u.test(unit);
    const diagnostics = validateRecordAuthoringChanges(root ? 'work_item'
      : KIND_RECORD_UNIT.test(unit) ? (unit.startsWith('IN-') ? 'initiative' : 'decision') : 'work_item',
    root || KIND_RECORD_UNIT.test(unit) ? 'existing' : 'existing_slice', changes);
    if (diagnostics.length) return refused({ unit, diagnostics });
  }
  if (exception !== undefined && !WORK_ITEM_UNIT.test(unit)) {
    return refused({ unit, diagnostics: [diagnostic(RECORD_AUTHORING_EXCEPTION_CODES.UNIT_UNSUPPORTED, "unit",
      "an exception is recorded on a work item or one of its slices; this unit has no proof, grammar or controlled-acceptance exception")] });
  }
  if (WORK_ITEM_UNIT.test(unit)) return saveWorkItem({ repoRoot, unit, revision, changes, exception }, options);
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

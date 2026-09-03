import path from "node:path";

export const LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_SCHEMA_VERSION =
  "workspace-agent-findings-lifecycle-context.v1";
export const LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID =
  "launcher_findings_lifecycle_context_invalid";
export const LAUNCHER_EFFECTIVE_WRITE_SCOPE_INVALID =
  "launcher_effective_write_scope_invalid";

const TRUSTED_FINDINGS_LIFECYCLE_CONTEXTS = new WeakSet();
const FINDINGS_EXECUTION_BINDS = new WeakMap();

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(detail) {
  return Object.freeze({
    ok: false,
    reason: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID,
    detail: Object.freeze({ authority_limb: "mechanical_failure", ...detail })
  });
}

function frozenBinds(value) {
  return Array.isArray(value) && Object.isFrozen(value) && value.every((entry) =>
    isPlainObject(entry) && Object.isFrozen(entry));
}

export function mintLauncherFindingsLifecycleContext({
  effectiveWriteScope,
  canonicalMetadataRoot,
  readinessBinding,
  trustedFrozenReviewContract,
  sourceSelectionCarrier,
  selectedUnit,
  subject,
  reviewMaterializationRoot = canonicalMetadataRoot,
  reviewerDependencyBinds = Object.freeze([])
} = {}) {
  if (!Array.isArray(effectiveWriteScope) || effectiveWriteScope.length !== 0 ||
      !Object.isFrozen(effectiveWriteScope)) {
    throw Object.assign(new Error(
      "findings lifecycle requires authenticated empty write_scope"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  if (typeof canonicalMetadataRoot !== "string" ||
      canonicalMetadataRoot.length === 0) {
    throw Object.assign(new Error(
      "findings lifecycle requires its authenticated canonical metadata root"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  if (typeof reviewMaterializationRoot !== "string" ||
      !path.isAbsolute(reviewMaterializationRoot)) {
    throw Object.assign(new Error(
      "findings lifecycle requires its action-private review materialization root"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  if (!isPlainObject(readinessBinding) || !Object.isFrozen(readinessBinding)) {
    throw Object.assign(new Error(
      "findings lifecycle requires launcher-admitted immutable readiness"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  if (!isPlainObject(trustedFrozenReviewContract) ||
      !Object.isFrozen(trustedFrozenReviewContract)) {
    throw Object.assign(new Error(
      "findings lifecycle requires a trusted frozen contract"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  if (!isPlainObject(sourceSelectionCarrier) ||
      !Object.isFrozen(sourceSelectionCarrier)) {
    throw Object.assign(new Error(
      "findings lifecycle requires the routing-owned source-selection carrier"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  if (typeof selectedUnit !== "string" || selectedUnit.length === 0 ||
      selectedUnit !== subject || sourceSelectionCarrier.subject !== subject) {
    throw Object.assign(new Error(
      "findings lifecycle selected unit, subject, and source must match"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  if (!frozenBinds(reviewerDependencyBinds)) {
    throw Object.assign(new Error(
      "findings lifecycle requires launcher-frozen dependency binds"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }

  let context;
  context = {
    schema_version: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_SCHEMA_VERSION,
    lifecycle: "findings",
    effective_write_scope: Object.freeze([]),
    canonical_metadata_root: canonicalMetadataRoot,
    review_materialization_root: path.resolve(reviewMaterializationRoot),
    readiness_binding: readinessBinding,
    trusted_frozen_review_contract: trustedFrozenReviewContract,
    source_selection_carrier: sourceSelectionCarrier,
    selected_unit: selectedUnit,
    subject
  };
  Object.defineProperty(context, "reviewer_dependency_binds", {
    enumerable: true,
    configurable: false,
    get: () => FINDINGS_EXECUTION_BINDS.get(context) ?? Object.freeze([])
  });
  FINDINGS_EXECUTION_BINDS.set(context, reviewerDependencyBinds);
  Object.freeze(context);
  TRUSTED_FINDINGS_LIFECYCLE_CONTEXTS.add(context);
  return context;
}

export function appendLauncherFindingsExecutionBinds(context, additions) {
  const consumed = consumeLauncherFindingsLifecycleContext(context, { required: true });
  if (!consumed.ok || !frozenBinds(additions)) {
    throw Object.assign(new Error(
      "findings execution binds require one trusted lifecycle context"
    ), { code: LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_INVALID });
  }
  FINDINGS_EXECUTION_BINDS.set(context, Object.freeze([
    ...context.reviewer_dependency_binds,
    ...additions
  ]));
  return context;
}

export function consumeLauncherFindingsLifecycleContext(context, {
  required = false,
  selectedUnit = null,
  subject = null
} = {}) {
  if (context === null || context === undefined) {
    return required
      ? invalid({ mismatch_class: "missing" })
      : Object.freeze({ ok: true, managed: false, context: null });
  }
  if (!isPlainObject(context) || !Object.isFrozen(context) ||
      !TRUSTED_FINDINGS_LIFECYCLE_CONTEXTS.has(context) ||
      context.schema_version !== LAUNCHER_FINDINGS_LIFECYCLE_CONTEXT_SCHEMA_VERSION ||
      context.lifecycle !== "findings" ||
      typeof context.review_materialization_root !== "string" ||
      !path.isAbsolute(context.review_materialization_root) ||
      !Array.isArray(context.effective_write_scope) ||
      context.effective_write_scope.length !== 0 ||
      !Object.isFrozen(context.effective_write_scope) ||
      !isPlainObject(context.readiness_binding) ||
      !Object.isFrozen(context.readiness_binding) ||
      !isPlainObject(context.trusted_frozen_review_contract) ||
      !Object.isFrozen(context.trusted_frozen_review_contract) ||
      !isPlainObject(context.source_selection_carrier) ||
      !Object.isFrozen(context.source_selection_carrier) ||
      !frozenBinds(context.reviewer_dependency_binds)) {
    return invalid({ mismatch_class: "malformed_or_untrusted" });
  }
  if ((selectedUnit !== null && context.selected_unit !== selectedUnit) ||
      (subject !== null && context.subject !== subject) ||
      context.selected_unit !== context.subject ||
      context.source_selection_carrier.subject !== context.subject) {
    return invalid({ mismatch_class: "identity_mismatch" });
  }
  return Object.freeze({ ok: true, managed: true, context });
}

export function selectLauncherLifecycleFromEffectiveWriteScope(effectiveWriteScope) {
  if (!Array.isArray(effectiveWriteScope) || !Object.isFrozen(effectiveWriteScope) ||
      effectiveWriteScope.some((entry) =>
        typeof entry !== "string" || entry.length === 0)) {
    throw Object.assign(new Error(
      "launcher lifecycle requires an authenticated immutable write_scope array"
    ), { code: LAUNCHER_EFFECTIVE_WRITE_SCOPE_INVALID });
  }
  return effectiveWriteScope.length === 0 ? "findings" : "implementation";
}

export function projectLauncherFindingsAuthorityInvariant(context) {
  const consumed = consumeLauncherFindingsLifecycleContext(context, { required: true });
  if (!consumed.ok) return consumed;
  return Object.freeze({
    lifecycle: context.lifecycle,
    canonical_metadata_source: context.canonical_metadata_root,
    review_materialization_source: context.review_materialization_root,
    frozen_contract_identity: context.trusted_frozen_review_contract,
    graph_impact_readiness_binding: context.readiness_binding,
    source_selection_carrier: context.source_selection_carrier,
    selected_unit: context.selected_unit,
    subject: context.subject
  });
}

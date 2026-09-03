

import {
  WORK_RECORD_REVIEW_PURPOSE_VALUES,
  WORK_RECORD_STATUS_VALUES
} from "./work-record-schema-constants.mjs";

export const WORK_RECORD_FINDINGS_WORK_KINDS = Object.freeze(["review", "redteam"]);

export const WORK_RECORD_FINDINGS_TECHNICAL_ROLE_BY_WORK_KIND = Object.freeze({
  review: "reviewer",
  redteam: "redteam"
});

export const WORK_RECORD_FINDINGS_ACCEPTED_REVIEW_PURPOSES = Object.freeze({
  review: Object.freeze(["standalone", "terminal_whole_wk"]),
  redteam: Object.freeze(["standalone"])
});

export const WORK_RECORD_REVIEWER_DEFAULT_REVIEW_PURPOSE = "standalone";

export const WORK_RECORD_FINDINGS_PURPOSE_ORIGIN_VALUES = Object.freeze([
  "authored",
  "reviewer_default",
  "absent"
]);

export const WORK_RECORD_FINDINGS_DIAGNOSTIC_CODES = Object.freeze([
  "findings_review_purpose_invalid_value",
  "findings_review_purpose_incompatible",
  "findings_role_conflict",
  "findings_ready_review_purpose_required"
]);

export const WORK_RECORD_FINDINGS_CENSUS_CATEGORIES = Object.freeze([
  "explicit_reviewer_purpose",
  "reviewer_omission_default",
  "explicit_redteam_standalone",
  "redteam_omission",
  "invalid_or_conflicting_findings_tuple"
]);

export const WORK_RECORD_FINDINGS_TERMINAL_STATUS_VALUES = Object.freeze([
  "done",
  "cancelled"
]);

export function isTerminalWorkUnitStatus(status) {
  return WORK_RECORD_FINDINGS_TERMINAL_STATUS_VALUES.includes(status);
}
export const WORK_RECORD_FINDINGS_CENSUS_OPEN_STATUS_VALUES = Object.freeze(
  WORK_RECORD_STATUS_VALUES.filter((status) => !isTerminalWorkUnitStatus(status))
);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createDiagnostic(code, message, { severity = "error", path = null } = {}) {
  return { code, severity, message, path };
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function fieldPath(basePath, field) {
  return basePath ? `${basePath}.${field}` : field;
}

export function analyzeWorkRecordFindingsUnit(unit, {
  path = null,
  requireExplicitRedteamPurpose = false
} = {}) {
  const diagnostics = [];
  const workKind = isObject(unit) ? unit.work_kind : undefined;
  const isFindings = WORK_RECORD_FINDINGS_WORK_KINDS.includes(workKind);
  const requiredRole = isFindings
    ? WORK_RECORD_FINDINGS_TECHNICAL_ROLE_BY_WORK_KIND[workKind]
    : null;

  const purposeAuthored = hasOwn(unit, "review_purpose");
  const authoredPurpose = purposeAuthored ? unit.review_purpose : undefined;

  const dispatchIntent = isObject(unit) ? unit.dispatch_intent : undefined;
  const roleAuthored = hasOwn(dispatchIntent, "intended_agent_role") &&
    dispatchIntent.intended_agent_role !== null;
  const declaredRole = roleAuthored ? dispatchIntent.intended_agent_role : null;

  let purposeValid = true;
  if (purposeAuthored) {
    if (!WORK_RECORD_REVIEW_PURPOSE_VALUES.includes(authoredPurpose)) {
      purposeValid = false;
      diagnostics.push(createDiagnostic(
        "findings_review_purpose_invalid_value",
        `${fieldPath(path, "review_purpose")} must be one of: ` +
          `${WORK_RECORD_REVIEW_PURPOSE_VALUES.map((value) => JSON.stringify(value)).join(", ")}`,
        { path: fieldPath(path, "review_purpose") }
      ));
    }
    const accepted = isFindings ? WORK_RECORD_FINDINGS_ACCEPTED_REVIEW_PURPOSES[workKind] : [];
    if (!accepted.includes(authoredPurpose)) {
      purposeValid = false;
      diagnostics.push(createDiagnostic(
        "findings_review_purpose_incompatible",
        `${fieldPath(path, "review_purpose")} is valid only for review work or standalone redteam work`,
        { path: fieldPath(path, "review_purpose") }
      ));
    }
  }

  const roleConflict = isFindings && roleAuthored && declaredRole !== requiredRole;
  if (roleConflict) {
    diagnostics.push(createDiagnostic(
      "findings_role_conflict",
      `${fieldPath(path, "dispatch_intent.intended_agent_role")} must be ` +
        `'${requiredRole}' for work_kind '${workKind}'; a conflicting authored role is refused, ` +
        "not normalized",
      { path: fieldPath(path, "dispatch_intent.intended_agent_role") }
    ));
  }

  if (
    requireExplicitRedteamPurpose &&
    workKind === "redteam" &&
    !(purposeAuthored && authoredPurpose === WORK_RECORD_REVIEWER_DEFAULT_REVIEW_PURPOSE)
  ) {
    diagnostics.push(createDiagnostic(
      "findings_ready_review_purpose_required",
      `${fieldPath(path, "review_purpose")} must be explicitly authored as ` +
        `${JSON.stringify(WORK_RECORD_REVIEWER_DEFAULT_REVIEW_PURPOSE)} for redteam findings work; ` +
        "retry the same authoring call with that value",
      { path: fieldPath(path, "review_purpose") }
    ));
  }

  let effectivePurpose = null;
  let origin = "absent";
  if (isFindings && purposeAuthored && purposeValid) {
    effectivePurpose = authoredPurpose;
    origin = "authored";
  } else if (workKind === "review" && !purposeAuthored) {
    effectivePurpose = WORK_RECORD_REVIEWER_DEFAULT_REVIEW_PURPOSE;
    origin = "reviewer_default";
  }

  return {
    is_findings_unit: isFindings,
    work_kind: workKind,
    required_technical_role: requiredRole,
    declared_technical_role: declaredRole,
    technical_role_authored: roleAuthored,
    review_purpose_authored: purposeAuthored,
    authored_review_purpose: authoredPurpose,
    effective_review_purpose: effectivePurpose,
    review_purpose_origin: origin,
    census_category: censusCategory({
      isFindings,
      workKind,
      purposeAuthored,
      purposeValid,
      roleConflict
    }),
    diagnostics
  };
}

function censusCategory({ isFindings, workKind, purposeAuthored, purposeValid, roleConflict }) {
  if (!isFindings) return null;
  if (roleConflict || (purposeAuthored && !purposeValid)) {
    return "invalid_or_conflicting_findings_tuple";
  }
  if (workKind === "review") {
    return purposeAuthored ? "explicit_reviewer_purpose" : "reviewer_omission_default";
  }
  return purposeAuthored ? "explicit_redteam_standalone" : "redteam_omission";
}

export function censusWorkRecordFindingsUnits(record, {
  openStatuses = WORK_RECORD_FINDINGS_CENSUS_OPEN_STATUS_VALUES
} = {}) {
  if (!isObject(record)) return [];
  const open = new Set(openStatuses);
  const rows = [];

  const consider = (unit, { scope, address, path }) => {
    if (!isObject(unit)) return;
    if (!WORK_RECORD_FINDINGS_WORK_KINDS.includes(unit.work_kind)) return;
    if (!open.has(unit.status)) return;
    const analysis = analyzeWorkRecordFindingsUnit(unit, { path });
    rows.push({
      address,
      scope,
      work_kind: analysis.work_kind,
      status: unit.status,
      declared_technical_role: analysis.declared_technical_role,
      required_technical_role: analysis.required_technical_role,
      review_purpose_authored: analysis.review_purpose_authored,
      authored_review_purpose: analysis.review_purpose_authored
        ? analysis.authored_review_purpose
        : null,
      category: analysis.census_category,

      requires_intent: analysis.census_category === "invalid_or_conflicting_findings_tuple" ||
        analysis.census_category === "redteam_omission",
      diagnostic_codes: analysis.diagnostics.map((entry) => entry.code)
    });
  };

  consider(record, { scope: "record", address: String(record.id), path: null });
  if (Array.isArray(record.slices)) {
    record.slices.forEach((slice, index) => {
      consider(slice, {
        scope: "slice",
        address: `${record.id}#${isObject(slice) ? slice.id : index}`,
        path: `slices[${index}]`
      });
    });
  }
  return rows;
}

export function summarizeWorkRecordFindingsCensus(rows) {
  const counts = Object.fromEntries(
    WORK_RECORD_FINDINGS_CENSUS_CATEGORIES.map((category) => [category, 0])
  );
  const unresolvedIntent = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (Object.hasOwn(counts, row?.category)) counts[row.category] += 1;
    if (row?.requires_intent) unresolvedIntent.push(row);
  }
  return {
    total: Array.isArray(rows) ? rows.length : 0,
    counts,
    unresolved_intent_count: unresolvedIntent.length,
    unresolved_intent: unresolvedIntent
  };
}

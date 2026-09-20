

import {
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";

const BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION =
  "controlled-contract-behavioral-preservation-verification.v1";

const BEHAVIORAL_PRESERVATION_PROFILE_ID = "proof.compatibility.behavioral-preservation";
const BEHAVIORAL_PRESERVATION_PROFILE_VERSION = "4.0.0";

const BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION =
  "controlled-contract-behavioral-preservation-report.v1";

const BEHAVIORAL_PRESERVATION_SIDES = Object.freeze(["baseline", "candidate"]);

const INPUT_FIELDS = Object.freeze([...BEHAVIORAL_PRESERVATION_SIDES]);

const REPORT_FIELDS = Object.freeze([
  "schema_version", "observables", "observable_count", "selected_observable_id"
]);

const OBSERVABLE_FIELDS = Object.freeze([
  "observable_id", "observable_type", "canonical_value"
]);

const BEHAVIORAL_PRESERVATION_VERIFICATION_REFUSAL_CODES = Object.freeze({
  MISSING_REQUIRED_INPUT:
    "controlled_contract.behavioral_preservation_verification.missing_required_input.v1",
  MALFORMED_INPUT:
    "controlled_contract.behavioral_preservation_verification.malformed_input.v1",
  MALFORMED_REPORT:
    "controlled_contract.behavioral_preservation_verification.malformed_report.v1",
  REPORT_POPULATION_INCONSISTENT:
    "controlled_contract.behavioral_preservation_verification.report_population_inconsistent.v1",
  CANONICAL_SELECTION_UNRESOLVED:
    "controlled_contract.behavioral_preservation_verification.canonical_selection_unresolved.v1",
  CANONICAL_SELECTION_AMBIGUOUS:
    "controlled_contract.behavioral_preservation_verification.canonical_selection_ambiguous.v1"
});

const CODES = BEHAVIORAL_PRESERVATION_VERIFICATION_REFUSAL_CODES;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnosticScalar(value) {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean": return value;
    case "function": return "[function]";
    case "symbol": return "[symbol]";
    case "bigint": return "[bigint]";
    default: return "[object]";
  }
}

function exactKeys(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function missingField(value, fields) {
  return fields.find((field) => !Object.hasOwn(value, field)) ?? null;
}

function unexpectedField(value, fields) {
  const allowed = new Set(fields);
  return Object.keys(value).filter((key) => !allowed.has(key))
    .sort(compareCodeUnits)[0] ?? null;
}

function isOpaqueIdentity(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function refuse(code, reason, detail = null) {
  return deepFreeze({
    schema_version: BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION,
    verified: false,
    preserved: null,
    profile_id: BEHAVIORAL_PRESERVATION_PROFILE_ID,
    profile_version: BEHAVIORAL_PRESERVATION_PROFILE_VERSION,
    report_schema_version: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
    source: null,
    members: null,
    differences: null,
    refusal: { code, reason, detail: detail === null ? null : structuredClone(detail) }
  });
}

function admitInput(input) {
  if (input === undefined || input === null) {
    return refuse(CODES.MISSING_REQUIRED_INPUT,
      "baseline and candidate reports are required to verify behavioral preservation",
      { input: "input" });
  }
  if (!isPlainObject(input)) {
    return refuse(CODES.MALFORMED_INPUT,
      "verification accepts one plain object carrying the baseline and candidate reports",
      { input: "input" });
  }
  if (!exactKeys(input, INPUT_FIELDS)) {
    return refuse(CODES.MALFORMED_INPUT,
      "verification accepts exactly the baseline and candidate reports", {
        missing_field: missingField(input, INPUT_FIELDS),
        unexpected_field: unexpectedField(input, INPUT_FIELDS)
      });
  }
  return null;
}

function observableDefect(observable) {
  if (!isPlainObject(observable) || !exactKeys(observable, OBSERVABLE_FIELDS)) {
    return "must be one typed observable descriptor with its exact field set";
  }
  for (const field of OBSERVABLE_FIELDS) {
    const value = observable[field];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      return `${field} must be a non-empty NUL-free string`;
    }
  }
  return null;
}

function admitReport(position, report) {
  if (!isPlainObject(report)) {
    return refuse(CODES.MALFORMED_REPORT,
      `${position} must be the typed behavior-report object`, { position });
  }
  if (report.schema_version !== BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION) {
    return refuse(CODES.MALFORMED_REPORT,
      `${position} must carry schema_version ${BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION}`, {
        position,
        supplied: typeof report.schema_version === "string" ? report.schema_version : null,
        expected: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION
      });
  }
  if (!exactKeys(report, REPORT_FIELDS)) {
    return refuse(CODES.MALFORMED_REPORT,
      `${position} must carry the exact accepted report field set`, {
        position,
        missing_field: missingField(report, REPORT_FIELDS),
        unexpected_field: unexpectedField(report, REPORT_FIELDS)
      });
  }
  if (!Array.isArray(report.observables)) {
    return refuse(CODES.MALFORMED_REPORT,
      `${position}.observables must be the complete typed observable population`,
      { position, field: "observables" });
  }
  const bad = report.observables.findIndex((observable) =>
    observableDefect(observable) !== null);
  if (bad !== -1) {
    return refuse(CODES.MALFORMED_REPORT,
      `${position}.observables[${bad}] ${observableDefect(report.observables[bad])}`,
      { position, index: bad });
  }
  if (!isOpaqueIdentity(report.selected_observable_id)) {
    return refuse(CODES.MALFORMED_REPORT,
      `${position}.selected_observable_id must be a non-empty observable id`, {
        position, field: "selected_observable_id",
        supplied: diagnosticScalar(report.selected_observable_id)
      });
  }
  return null;
}

function descriptorKey({ observable_id: observableId, observable_type: observableType }) {
  return canonicalJsonBytes({
    observable_id: observableId, observable_type: observableType
  }).toString("utf8");
}

function admitReportConsistency(position, report) {
  if (!Number.isInteger(report.observable_count) || report.observable_count < 0) {
    return refuse(CODES.REPORT_POPULATION_INCONSISTENT,
      `${position}.observable_count must be a non-negative integer count`,
      { position, supplied: diagnosticScalar(report.observable_count) });
  }
  if (report.observable_count !== report.observables.length) {
    return refuse(CODES.REPORT_POPULATION_INCONSISTENT,
      `${position}.observable_count disagrees with the length of observables`,
      { position, declared: report.observable_count, actual: report.observables.length });
  }
  const seen = new Set();
  for (const observable of report.observables) {
    const key = descriptorKey(observable);
    if (seen.has(key)) {
      return refuse(CODES.REPORT_POPULATION_INCONSISTENT,
        `${position}.observables repeats one typed observable descriptor`, {
          position,
          observable_id: observable.observable_id,
          observable_type: observable.observable_type
        });
    }
    seen.add(key);
  }
  return null;
}

function resolveSelectedObservable(position, report) {
  const matches = report.observables.filter(
    ({ observable_id: observableId }) => observableId === report.selected_observable_id
  );
  if (matches.length === 0) {
    return { observable: null, refusal: refuse(CODES.CANONICAL_SELECTION_UNRESOLVED,
      `${position} selects an observable absent from its own population`,
      { position, selected_observable_id: report.selected_observable_id }) };
  }
  if (matches.length > 1) {
    return { observable: null, refusal: refuse(CODES.CANONICAL_SELECTION_AMBIGUOUS,
      `${position} selects an observable id carried by more than one typed descriptor`, {
        position,
        selected_observable_id: report.selected_observable_id,
        match_count: matches.length
      }) };
  }
  return { observable: matches[0], refusal: null };
}

function memberDescriptors(report) {
  return report.observables.map((observable) => ({
    observable_id: observable.observable_id,
    observable_type: observable.observable_type
  }));
}

function verifyBehavioralPreservationReports(input) {
  const inputRefusal = admitInput(input);
  if (inputRefusal !== null) return inputRefusal;
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const reportRefusal = admitReport(position, input[position]) ??
      admitReportConsistency(position, input[position]);
    if (reportRefusal !== null) return reportRefusal;
  }
  const reports = Object.fromEntries(BEHAVIORAL_PRESERVATION_SIDES.map(
    (position) => [position, input[position]]
  ));
  const selected = {};
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const { observable, refusal } = resolveSelectedObservable(position, reports[position]);
    if (refusal !== null) return refusal;
    selected[position] = observable;
  }

  const baselineKeys = new Set(reports.baseline.observables.map(descriptorKey));
  const candidateKeys = new Set(reports.candidate.observables.map(descriptorKey));
  const onlyInBaseline = reports.baseline.observables.filter(
    (observable) => !candidateKeys.has(descriptorKey(observable))
  ).map(({ observable_id: id, observable_type: type }) =>
    ({ observable_id: id, observable_type: type }));
  const onlyInCandidate = reports.candidate.observables.filter(
    (observable) => !baselineKeys.has(descriptorKey(observable))
  ).map(({ observable_id: id, observable_type: type }) =>
    ({ observable_id: id, observable_type: type }));
  const differences = {
    baseline_population_not_subset: onlyInBaseline.length > 0,
    candidate_population_not_subset: onlyInCandidate.length > 0,
    only_in_baseline: onlyInBaseline,
    only_in_candidate: onlyInCandidate,
    count_mismatch: reports.baseline.observable_count !== reports.candidate.observable_count,
    selection_mismatch:
      reports.baseline.selected_observable_id !== reports.candidate.selected_observable_id,
    canonical_value_mismatch:
      selected.baseline.canonical_value !== selected.candidate.canonical_value
  };
  const preserved = !differences.baseline_population_not_subset &&
    !differences.candidate_population_not_subset && !differences.count_mismatch &&
    !differences.selection_mismatch && !differences.canonical_value_mismatch;
  return deepFreeze({
    schema_version: BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION,
    verified: true,
    preserved,
    profile_id: BEHAVIORAL_PRESERVATION_PROFILE_ID,
    profile_version: BEHAVIORAL_PRESERVATION_PROFILE_VERSION,
    report_schema_version: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
    source: {
      sides: BEHAVIORAL_PRESERVATION_SIDES.map((position) => ({
        position,
        observable_count: reports[position].observable_count,
        selected_observable_id: reports[position].selected_observable_id,
        selected_canonical_value: selected[position].canonical_value
      }))
    },
    members: {
      baseline: memberDescriptors(reports.baseline),
      candidate: memberDescriptors(reports.candidate)
    },
    differences,
    refusal: null
  });
}

export {
  BEHAVIORAL_PRESERVATION_PROFILE_ID,
  BEHAVIORAL_PRESERVATION_PROFILE_VERSION,
  BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_SIDES,
  BEHAVIORAL_PRESERVATION_VERIFICATION_REFUSAL_CODES,
  BEHAVIORAL_PRESERVATION_VERIFICATION_SCHEMA_VERSION,
  verifyBehavioralPreservationReports
};

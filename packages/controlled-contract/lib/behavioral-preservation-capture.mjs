

import {
  CAPTURE_ROLE_DEFECTS,
  assembleCaptureEvaluationInput,
  canonicalCaptureEvaluationInputJson,
  capturePackIdentityMismatch,
  captureEvaluationInputDiagnostics,
  createCaptureResultFactory,
  diagnosticScalar,
  isPlainObject,
  planCaptureRoleBindings,
  resolveCapturePackSnapshot,
  resolveExactlyOneEvaluationStage
} from "./capture-mapping.mjs";
import {
  canonicalJsonBytes,
  compareCodeUnits
} from "./deterministic-projection-primitives.mjs";

const BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION =
  "controlled-contract-behavioral-preservation-capture.v1";

const BEHAVIORAL_PRESERVATION_PROFILE_ID = "proof.compatibility.behavioral-preservation";
const BEHAVIORAL_PRESERVATION_PROFILE_VERSION = "2.0.0";

const BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION =
  "controlled-contract-behavioral-preservation-capture-input.v1";
const BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION =
  "controlled-contract-behavioral-preservation-report.v1";

const BEHAVIORAL_PRESERVATION_SIDES = Object.freeze(["baseline", "candidate"]);

const SIDE_RESULT_ROLES = Object.freeze({
  baseline: "left_result",
  candidate: "right_result"
});

const CAPTURE_FIELDS = Object.freeze([
  "schema_version", "pair", "baseline", "candidate"
]);

const PAIR_FIELDS = Object.freeze(["pair_id", "pair_digest"]);

const SIDE_FIELDS = Object.freeze([
  "evidence_id", "evidence_digest", "source", "report"
]);

const SOURCE_FIELDS = Object.freeze(["kind", "relative_path"]);

const REPORT_FIELDS = Object.freeze([
  "schema_version", "observables", "observable_count", "selected_observable_id"
]);

const OBSERVABLE_FIELDS = Object.freeze([
  "observable_id", "observable_type", "canonical_value"
]);

const ARTIFACT_FILE_KIND = "artifact_file";

const CONDITION_VALUES = Object.freeze({
  left_population_not_subset_condition:
    "left-observable-population-not-subset-of-right-observable-population",
  right_population_not_subset_condition:
    "right-observable-population-not-subset-of-left-observable-population",
  left_count_mismatch_condition: "left-count-signal-not-equal-to-shared-member-count",
  right_count_mismatch_condition: "right-count-signal-not-equal-to-shared-member-count",
  canonical_value_mismatch_condition:
    "left-selected-canonical-value-not-equal-to-right-selected-canonical-value"
});

const IDENTITY_DOMAINS = Object.freeze({
  logicalSource: "behavioral-preservation.logical-source",
  report: "behavioral-preservation.behavior-report",
  population: "behavioral-preservation.observable-population",
  observable: "behavioral-preservation.typed-observable",
  countSignal: "behavioral-preservation.count-signal",
  canonicalValue: "behavioral-preservation.selected-canonical-value",
  verification: "behavioral-preservation.verification",
  condition: "behavioral-preservation.condition"
});

const BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES = Object.freeze({
  MISSING_REQUIRED_INPUT:
    "controlled_contract.behavioral_preservation_capture.missing_required_input.v1",
  MALFORMED_CAPTURE:
    "controlled_contract.behavioral_preservation_capture.malformed_capture.v1",
  CAPTURE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.behavioral_preservation_capture.capture_schema_version_unsupported.v1",
  MALFORMED_PAIR_IDENTITY:
    "controlled_contract.behavioral_preservation_capture.malformed_pair_identity.v1",
  MALFORMED_SIDE:
    "controlled_contract.behavioral_preservation_capture.malformed_side.v1",
  MALFORMED_SOURCE_DESCRIPTOR:
    "controlled_contract.behavioral_preservation_capture.malformed_source_descriptor.v1",
  MALFORMED_REPORT:
    "controlled_contract.behavioral_preservation_capture.malformed_report.v1",
  REPORT_POPULATION_INCONSISTENT:
    "controlled_contract.behavioral_preservation_capture.report_population_inconsistent.v1",
  OBSERVABLE_DESCRIPTOR_UNSUPPORTED:
    "controlled_contract.behavioral_preservation_capture.observable_descriptor_unsupported.v1",
  CANONICAL_SELECTION_UNRESOLVED:
    "controlled_contract.behavioral_preservation_capture.canonical_selection_unresolved.v1",
  CANONICAL_SELECTION_AMBIGUOUS:
    "controlled_contract.behavioral_preservation_capture.canonical_selection_ambiguous.v1",
  MEMBER_COUNT_ROLE_UNFILLABLE:
    "controlled_contract.behavioral_preservation_capture.member_count_role_unfillable.v1",
  PACK_SNAPSHOT_UNRECOGNIZED:
    "controlled_contract.behavioral_preservation_capture.pack_snapshot_unrecognized.v1",
  PROFILE_IDENTITY_MISMATCH:
    "controlled_contract.behavioral_preservation_capture.profile_identity_mismatch.v1",
  PACK_STAGE_UNSUPPORTED:
    "controlled_contract.behavioral_preservation_capture.pack_stage_unsupported.v1",
  PACK_ROLE_INCOMPATIBLE:
    "controlled_contract.behavioral_preservation_capture.pack_role_incompatible.v1",
  EXACT_BINDING_DECLARATION_INCOMPATIBLE:
    "controlled_contract.behavioral_preservation_capture.exact_binding_declaration_incompatible.v1",
  EVALUATION_INPUT_INVALID:
    "controlled_contract.behavioral_preservation_capture.evaluation_input_invalid.v1"
});

const RESULTS = createCaptureResultFactory({
  schemaVersion: BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION,
  identity: {
    profile_id: BEHAVIORAL_PRESERVATION_PROFILE_ID,
    profile_version: BEHAVIORAL_PRESERVATION_PROFILE_VERSION,
    capture_input_schema_version: BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION,
    report_schema_version: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION
  },
  nullFields: ["exact_binding_sources"]
});

const refuse = (code, reason, detail = null) => RESULTS.refuse(code, reason, detail);

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

function admitCapture(capture) {
  if (capture === undefined || capture === null) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MISSING_REQUIRED_INPUT,
      "capture is required to map a paired behavioral-preservation capture",
      { input: "capture" }
    );
  }
  if (!isPlainObject(capture)) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_CAPTURE,
      "capture must be the bounded paired behavioral-preservation capture object",
      { input: "capture" }
    );
  }
  if (capture.schema_version !== BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.CAPTURE_SCHEMA_VERSION_UNSUPPORTED,
      `capture must carry schema_version ${BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION}`,
      {
        supplied: typeof capture.schema_version === "string" ? capture.schema_version : null,
        expected: BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION
      }
    );
  }
  if (!exactKeys(capture, CAPTURE_FIELDS)) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_CAPTURE,
      "capture must carry the exact accepted field set",
      {
        missing_field: missingField(capture, CAPTURE_FIELDS),
        unexpected_field: unexpectedField(capture, CAPTURE_FIELDS)
      }
    );
  }
  return null;
}

function admitPairIdentity(pair) {
  if (!isPlainObject(pair) || !exactKeys(pair, PAIR_FIELDS)) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_PAIR_IDENTITY,
      "capture.pair must carry exactly the opaque pair identity and pair digest",
      {
        missing_field: isPlainObject(pair) ? missingField(pair, PAIR_FIELDS) : null,
        unexpected_field: isPlainObject(pair) ? unexpectedField(pair, PAIR_FIELDS) : null
      }
    );
  }
  for (const field of PAIR_FIELDS) {
    if (!isOpaqueIdentity(pair[field])) {
      return refuse(
        BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_PAIR_IDENTITY,
        `capture.pair.${field} must be a non-empty opaque identity string`,
        { field, supplied: diagnosticScalar(pair[field]) }
      );
    }
  }
  return null;
}

function admitSideShape(position, side) {
  if (!isPlainObject(side) || !exactKeys(side, SIDE_FIELDS)) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_SIDE,
      `capture.${position} must carry the exact accepted side field set`,
      {
        position,
        missing_field: isPlainObject(side) ? missingField(side, SIDE_FIELDS) : null,
        unexpected_field: isPlainObject(side) ? unexpectedField(side, SIDE_FIELDS) : null
      }
    );
  }
  for (const field of ["evidence_id", "evidence_digest"]) {
    if (!isOpaqueIdentity(side[field])) {
      return refuse(
        BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_SIDE,
        `capture.${position}.${field} must be a non-empty opaque side artifact identity`,
        { position, field, supplied: diagnosticScalar(side[field]) }
      );
    }
  }
  return null;
}

function sourceDescriptorDefect(descriptor) {
  if (!isPlainObject(descriptor) || !exactKeys(descriptor, SOURCE_FIELDS)) {
    return "must be one { kind, relative_path } exact source descriptor object";
  }
  if (descriptor.kind !== ARTIFACT_FILE_KIND) {
    return `kind must be ${ARTIFACT_FILE_KIND}`;
  }
  const relativePath = descriptor.relative_path;
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return "relative_path must be a non-empty string";
  }
  if (relativePath.includes("\0")) return "relative_path must be NUL-free";
  if (relativePath.startsWith("/")) {
    return "relative_path must be repository-relative, not absolute";
  }
  const components = relativePath.split("/");
  if (components.some((component) =>
    component.length === 0 || component === "." || component === "..")) {
    return "relative_path must not contain an empty, current, or parent component";
  }
  return null;
}

function admitSourceDescriptor(position, descriptor) {
  const defect = sourceDescriptorDefect(descriptor);
  if (defect === null) return null;
  return refuse(
    BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_SOURCE_DESCRIPTOR,
    `capture.${position}.source ${defect}`,
    { position, defect }
  );
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
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_REPORT,
      `capture.${position}.report must be the typed behavior-report object`,
      { position }
    );
  }
  if (report.schema_version !== BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_REPORT,
      `capture.${position}.report must carry schema_version ${BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION}`,
      {
        position,
        supplied: typeof report.schema_version === "string" ? report.schema_version : null,
        expected: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION
      }
    );
  }
  if (!exactKeys(report, REPORT_FIELDS)) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_REPORT,
      `capture.${position}.report must carry the exact accepted report field set`,
      {
        position,
        missing_field: missingField(report, REPORT_FIELDS),
        unexpected_field: unexpectedField(report, REPORT_FIELDS)
      }
    );
  }
  if (!Array.isArray(report.observables)) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_REPORT,
      `capture.${position}.report.observables must be the complete typed observable population`,
      { position, field: "observables" }
    );
  }
  const bad = report.observables.findIndex((observable) =>
    observableDefect(observable) !== null);
  if (bad !== -1) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_REPORT,
      `capture.${position}.report.observables[${bad}] ${observableDefect(report.observables[bad])}`,
      { position, index: bad }
    );
  }
  if (!isOpaqueIdentity(report.selected_observable_id)) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MALFORMED_REPORT,
      `capture.${position}.report.selected_observable_id must be a non-empty observable id`,
      { position, field: "selected_observable_id",
        supplied: diagnosticScalar(report.selected_observable_id) }
    );
  }
  return null;
}

function admitReportConsistency(position, report) {
  if (!Number.isInteger(report.observable_count) || report.observable_count < 0) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.REPORT_POPULATION_INCONSISTENT,
      `capture.${position}.report.observable_count must be a non-negative integer count`,
      { position, supplied: diagnosticScalar(report.observable_count) }
    );
  }
  if (report.observable_count !== report.observables.length) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.REPORT_POPULATION_INCONSISTENT,
      `capture.${position}.report.observable_count disagrees with the length of observables`,
      {
        position,
        declared: report.observable_count,
        actual: report.observables.length
      }
    );
  }
  const seen = new Set();
  for (const observable of report.observables) {
    const key = descriptorKey(observable);
    if (seen.has(key)) {
      return refuse(
        BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.REPORT_POPULATION_INCONSISTENT,
        `capture.${position}.report.observables repeats one typed observable descriptor`,
        {
          position,
          observable_id: observable.observable_id,
          observable_type: observable.observable_type
        }
      );
    }
    seen.add(key);
  }
  return null;
}

function descriptorKey({ observable_id: observableId, observable_type: observableType }) {
  return canonicalJsonBytes({
    observable_id: observableId, observable_type: observableType
  }).toString("utf8");
}

function slugSegment(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function memberReferenceId(observable) {
  const id = slugSegment(observable.observable_id);
  const type = slugSegment(observable.observable_type);
  if (id.length === 0 || type.length === 0) return null;
  return `ref-member-${id}-${type}`;
}

function memberIdentity(observable) {
  return {
    kind: "durable_id",
    domain: IDENTITY_DOMAINS.observable,
    value: descriptorKey(observable)
  };
}

function deriveSharedMembers(reports) {
  const byReferenceId = new Map();
  const perSide = {};
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const members = [];
    for (const observable of reports[position].observables) {
      const referenceId = memberReferenceId(observable);
      if (referenceId === null) {
        return {
          members: null,
          defect: {
            position,
            reason: "a typed observable descriptor yields no representable reference id",
            observable_id: observable.observable_id,
            observable_type: observable.observable_type
          }
        };
      }
      const identity = memberIdentity(observable);
      const existing = byReferenceId.get(referenceId);
      if (existing !== undefined && existing.value !== identity.value) {
        return {
          members: null,
          defect: {
            position,
            reason: "two distinct typed observable descriptors collide on one reference id",
            reference_id: referenceId,
            observable_id: observable.observable_id,
            observable_type: observable.observable_type
          }
        };
      }
      byReferenceId.set(referenceId, identity);
      members.push({ reference_id: referenceId, identity });
    }
    perSide[position] = members;
  }
  return { members: perSide, defect: null };
}

function resolveSelectedObservable(position, report) {
  const matches = report.observables.filter(
    ({ observable_id: observableId }) => observableId === report.selected_observable_id
  );
  if (matches.length === 0) {
    return {
      observable: null,
      refusal: refuse(
        BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.CANONICAL_SELECTION_UNRESOLVED,
        `capture.${position}.report selects an observable absent from its own population`,
        { position, selected_observable_id: report.selected_observable_id }
      )
    };
  }
  if (matches.length > 1) {
    return {
      observable: null,
      refusal: refuse(
        BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.CANONICAL_SELECTION_AMBIGUOUS,
        `capture.${position}.report selects an observable id carried by more than one typed descriptor`,
        {
          position,
          selected_observable_id: report.selected_observable_id,
          match_count: matches.length
        }
      )
    };
  }
  return { observable: matches[0], refusal: null };
}

function resolveExactBindingRequirements(pack) {
  const declaration = pack.declaration;
  if (!isPlainObject(declaration) || !Array.isArray(declaration.requirements)) return null;
  const byRole = new Map();
  for (const requirement of declaration.requirements) {
    if (requirement.binding_kind !== "artifact_bytes") continue;
    const coverage = requirement.role_coverage ?? [];
    if (coverage.length !== 1) continue;
    byRole.set(coverage[0].role, requirement.requirement_id);
  }
  const resolved = {};
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const requirementId = byRole.get(SIDE_RESULT_ROLES[position]);
    if (typeof requirementId !== "string" || requirementId.length === 0) return null;
    resolved[position] = requirementId;
  }
  if (resolved.baseline === resolved.candidate) return null;
  return resolved;
}

const durable = (domain, value) => ({ kind: "durable_id", domain, value });

function buildRolePlan({ pair, sides, members, selected }) {
  const singleton = (referenceId, identity) => () => [
    { reference_id: referenceId, identity }
  ];
  const sideSingleton = (referenceId, domain, position) =>
    singleton(referenceId, durable(domain, sides[position].evidence_id));
  const condition = (role) => Object.freeze({
    role,
    typeTerms: Object.freeze(["cc:state", "cc:configuration"]),
    identityKinds: Object.freeze(["durable_id"]),
    build: singleton(
      `ref-${role.replaceAll("_", "-")}`,
      durable(IDENTITY_DOMAINS.condition, CONDITION_VALUES[role])
    )
  });
  return [
    {

      role: "logical_source",
      typeTerms: ["cc:entity", "cc:resource"],
      identityKinds: ["durable_id"],
      build: singleton("ref-logical-source",
        durable(IDENTITY_DOMAINS.logicalSource, pair.pair_id))
    },
    {
      role: "left_result",
      typeTerms: ["cc:artifact", "cc:resource"],
      identityKinds: ["durable_id"],
      build: sideSingleton("ref-left-result", IDENTITY_DOMAINS.report, "baseline")
    },
    {
      role: "right_result",
      typeTerms: ["cc:artifact", "cc:resource"],
      identityKinds: ["durable_id"],
      build: sideSingleton("ref-right-result", IDENTITY_DOMAINS.report, "candidate")
    },
    {
      role: "left_population",
      typeTerms: ["cc:population"],
      identityKinds: ["durable_id"],
      build: sideSingleton("ref-left-population", IDENTITY_DOMAINS.population, "baseline")
    },
    {

      role: "left_members",
      typeTerms: ["cc:entity", "cc:resource", "cc:artifact", "cc:configuration"],
      identityKinds: ["durable_id"],
      build: () => members.baseline
    },
    {
      role: "right_population",
      typeTerms: ["cc:population"],
      identityKinds: ["durable_id"],
      build: sideSingleton("ref-right-population", IDENTITY_DOMAINS.population, "candidate")
    },
    {
      role: "right_members",
      typeTerms: ["cc:entity", "cc:resource", "cc:artifact", "cc:configuration"],
      identityKinds: ["durable_id"],
      build: () => members.candidate
    },
    {
      role: "left_count_signal",
      typeTerms: ["cc:evidence", "cc:artifact"],
      identityKinds: ["durable_id"],
      build: sideSingleton("ref-left-count", IDENTITY_DOMAINS.countSignal, "baseline")
    },
    {
      role: "right_count_signal",
      typeTerms: ["cc:evidence", "cc:artifact"],
      identityKinds: ["durable_id"],
      build: sideSingleton("ref-right-count", IDENTITY_DOMAINS.countSignal, "candidate")
    },
    {

      role: "left_selected_canonical_value",
      typeTerms: ["cc:entity", "cc:resource", "cc:artifact", "cc:configuration"],
      identityKinds: ["durable_id"],
      build: singleton("ref-left-value",
        durable(IDENTITY_DOMAINS.canonicalValue, selected.baseline.canonical_value))
    },
    {
      role: "right_selected_canonical_value",
      typeTerms: ["cc:entity", "cc:resource", "cc:artifact", "cc:configuration"],
      identityKinds: ["durable_id"],
      build: singleton("ref-right-value",
        durable(IDENTITY_DOMAINS.canonicalValue, selected.candidate.canonical_value))
    },
    {

      role: "verification",
      typeTerms: ["cc:process", "cc:test"],
      identityKinds: ["durable_id"],
      build: singleton("ref-verification",
        durable(IDENTITY_DOMAINS.verification, pair.pair_digest))
    },
    ...Object.keys(CONDITION_VALUES).map(condition)
  ];
}

const ROLE_DEFECT_REASONS = Object.freeze({
  [CAPTURE_ROLE_DEFECTS.ROLE_UNFILLABLE]: () =>
    "the admitted pack declares a reference role this mapping cannot fill",
  [CAPTURE_ROLE_DEFECTS.TYPE_TERM_UNSUPPORTED]: ({ role }) =>
    `the admitted pack allows no type term this mapping can supply for ${role}`,
  [CAPTURE_ROLE_DEFECTS.IDENTITY_KIND_UNSUPPORTED]: ({ role }) =>
    `the admitted pack allows no identity kind this mapping can supply for ${role}`,
  [CAPTURE_ROLE_DEFECTS.CARDINALITY_INVALID]: ({ role }) =>
    `the captured reports fill ${role} with a member count the pack forbids`,
  [CAPTURE_ROLE_DEFECTS.REFERENCE_IDENTITY_CONFLICT]: ({ role }) =>
    `this mapping emitted two conflicting definitions of one reference for ${role}`
});

async function mapBehavioralPreservationCapture({ capture, pack = null } = {}) {
  const captureRefusal = admitCapture(capture);
  if (captureRefusal !== null) return captureRefusal;

  const pairRefusal = admitPairIdentity(capture.pair);
  if (pairRefusal !== null) return pairRefusal;

  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const sideRefusal = admitSideShape(position, capture[position]);
    if (sideRefusal !== null) return sideRefusal;
  }

  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const sourceRefusal = admitSourceDescriptor(position, capture[position].source);
    if (sourceRefusal !== null) return sourceRefusal;
  }
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const reportRefusal = admitReport(position, capture[position].report) ??
      admitReportConsistency(position, capture[position].report);
    if (reportRefusal !== null) return reportRefusal;
  }

  const reports = Object.fromEntries(BEHAVIORAL_PRESERVATION_SIDES.map(
    (position) => [position, capture[position].report]
  ));

  if (reports.baseline.selected_observable_id !== reports.candidate.selected_observable_id) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.CANONICAL_SELECTION_AMBIGUOUS,
      "the two reports declare different canonical value selections, so the pair selection is ambiguous",
      {
        baseline: reports.baseline.selected_observable_id,
        candidate: reports.candidate.selected_observable_id
      }
    );
  }
  const selected = {};
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    const { observable, refusal } = resolveSelectedObservable(position, reports[position]);
    if (refusal !== null) return refusal;
    selected[position] = observable;
  }

  if (reports.baseline.observable_count !== reports.candidate.observable_count) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.MEMBER_COUNT_ROLE_UNFILLABLE,
      "the pack binds one shared member_count and the two reports declare different counts",
      {
        role: "member_count",
        baseline: reports.baseline.observable_count,
        candidate: reports.candidate.observable_count
      }
    );
  }
  const memberCount = reports.baseline.observable_count;

  const { members, defect: memberDefect } = deriveSharedMembers(reports);
  if (memberDefect !== null) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.OBSERVABLE_DESCRIPTOR_UNSUPPORTED,
      `capture.${memberDefect.position}.report ${memberDefect.reason}`,
      memberDefect
    );
  }

  const { admitted, unrecognized } = await resolveCapturePackSnapshot({
    pack, profileId: BEHAVIORAL_PRESERVATION_PROFILE_ID
  });
  if (unrecognized) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.PACK_SNAPSHOT_UNRECOGNIZED,
      "a supplied pack must be the exact snapshot returned by the admitted-pack loader",
      { input: "pack" }
    );
  }

  const identityMismatch = capturePackIdentityMismatch(admitted.profile, {
    profileId: BEHAVIORAL_PRESERVATION_PROFILE_ID,
    profileVersion: BEHAVIORAL_PRESERVATION_PROFILE_VERSION
  });
  if (identityMismatch !== null) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.PROFILE_IDENTITY_MISMATCH,
      "this mapping is written against one exact admitted pack identity",
      identityMismatch
    );
  }

  const { stage, declaredStageCount } =
    resolveExactlyOneEvaluationStage(admitted.profile);
  if (stage === null) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.PACK_STAGE_UNSUPPORTED,
      "this mapping fills one evaluation stage and the pack does not declare exactly one",
      { declared_stage_count: declaredStageCount }
    );
  }

  const requirements = resolveExactBindingRequirements(admitted);
  if (requirements === null) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.EXACT_BINDING_DECLARATION_INCOMPATIBLE,
      "the admitted pack does not declare one distinct artifact_bytes requirement per ordered result role",
      { result_roles: { ...SIDE_RESULT_ROLES } }
    );
  }

  const { bindings, references, defect } = planCaptureRoleBindings(
    admitted.profile,
    buildRolePlan({ pair: capture.pair, sides: capture, members, selected })
  );
  if (defect !== null) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.PACK_ROLE_INCOMPATIBLE,
      ROLE_DEFECT_REASONS[defect.kind](defect.detail),
      defect.detail
    );
  }

  const evaluationInput = assembleCaptureEvaluationInput({
    stage,
    referenceBindings: bindings,
    numberBindings: [{ role: "member_count", value: memberCount }]
  });
  const diagnostics = captureEvaluationInputDiagnostics(evaluationInput);
  if (diagnostics !== null) {
    return refuse(
      BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES.EVALUATION_INPUT_INVALID,
      "the mapped evaluation input does not satisfy the owning evaluation-input schema",
      { diagnostics }
    );
  }

  return RESULTS.accept({
    source: {
      pair_id: capture.pair.pair_id,
      pair_digest: capture.pair.pair_digest,
      member_count: memberCount,
      selected_observable_id: reports.baseline.selected_observable_id,
      sides: BEHAVIORAL_PRESERVATION_SIDES.map((position) => ({
        position,
        evidence_id: capture[position].evidence_id,
        evidence_digest: capture[position].evidence_digest,
        exact_binding_requirement_id: requirements[position],
        relative_path: capture[position].source.relative_path
      }))
    },
    references,
    evaluationInput,
    additional: {
      exact_binding_sources: Object.fromEntries(BEHAVIORAL_PRESERVATION_SIDES.map(
        (position) => [requirements[position], {
          kind: ARTIFACT_FILE_KIND,
          relative_path: capture[position].source.relative_path
        }]
      ))
    }
  });
}

function canonicalBehavioralPreservationEvaluationInputJson(result) {
  return canonicalCaptureEvaluationInputJson(result, "behavioral-preservation capture");
}

export {
  BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES,
  BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_PROFILE_ID,
  BEHAVIORAL_PRESERVATION_PROFILE_VERSION,
  BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_SIDES,
  canonicalBehavioralPreservationEvaluationInputJson,
  mapBehavioralPreservationCapture
};

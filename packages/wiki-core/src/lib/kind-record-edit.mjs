

import {
  getRecordKindSpec,
  validateRecordByKind
} from "./work-record-kind-registry.mjs";

const MANAGED_TOP_LEVEL_FIELDS = Object.freeze([
  "status",
  "ratified",
  "ratified_by",
  "updated",
  "updated_by"
]);

const CONTROLLED_REQUIRED_SCALARS_BY_KIND = Object.freeze({
  decision: Object.freeze(["owners", "date"])
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isNonEmptyString(value) {
  return isString(value) && value.trim() !== "";
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createDiagnostic(code, message, { severity = "error", path = null } = {}) {
  return { code, severity, message, path };
}

function refusal(diagnostic) {
  return {
    ok: false,
    updatedRecord: null,
    changedFields: [],
    diagnostics: [diagnostic]
  };
}

function finalizeEdit(updatedRecord, changedFields) {
  const diagnostics = validateRecordByKind(updatedRecord);
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { ok: false, updatedRecord: null, changedFields: [], diagnostics };
  }
  return { ok: true, updatedRecord, changedFields, diagnostics };
}

function guardCommon(record, actor, now) {
  if (!isObject(record)) {
    return { ok: false, refusal: refusal(createDiagnostic("invalid_record", "record must be an object", { path: null })) };
  }
  const spec = getRecordKindSpec(record.record_kind);
  if (!spec) {
    return {
      ok: false,
      refusal: refusal(
        createDiagnostic("unsupported_record_kind", `Unsupported record kind: ${record.record_kind}`, {
          path: "record_kind"
        })
      )
    };
  }
  if (!isNonEmptyString(actor)) {
    return {
      ok: false,
      refusal: refusal(createDiagnostic("invalid_provenance_input", "actor must be a non-empty string", { path: "actor" }))
    };
  }
  if (!isNonEmptyString(now)) {
    return {
      ok: false,
      refusal: refusal(createDiagnostic("invalid_provenance_input", "now must be a non-empty string", { path: "now" }))
    };
  }
  return { ok: true, spec };
}

function amendOfAcceptedRefusal(record) {
  if (record.record_kind === "decision" && record.status === "accepted") {
    return refusal(
      createDiagnostic(
        "amend_of_accepted_decision",
        "cannot amend an accepted decision; unratify it to `proposed` first",
        { path: "status" }
      )
    );
  }
  return null;
}

function stampProvenance(target, actor, now, changedFields) {
  target.updated = now;
  target.updated_by = actor;
  changedFields.push("updated", "updated_by");
}

export function setSection({ record, section, value, actor, now } = {}) {
  const guard = guardCommon(record, actor, now);
  if (!guard.ok) {
    return guard.refusal;
  }
  const { spec } = guard;
  if (!isNonEmptyString(section)) {
    return refusal(createDiagnostic("invalid_section", "section must be a non-empty string", { path: "section" }));
  }
  if (!Object.prototype.hasOwnProperty.call(spec.sectionSpec, section)) {
    return refusal(
      createDiagnostic(
        "unsupported_section",
        `Unsupported section '${section}' for ${spec.recordKind}; expected one of: ${Object.keys(spec.sectionSpec).join(", ")}`,
        { path: "section" }
      )
    );
  }
  const accepted = amendOfAcceptedRefusal(record);
  if (accepted) {
    return accepted;
  }

  const clone = cloneJson(record);
  if (!isObject(clone.sections)) {
    clone.sections = {};
  }
  clone.sections[section] = cloneJson(value);
  const changedFields = [`sections.${section}`];
  stampProvenance(clone, actor, now, changedFields);
  return finalizeEdit(clone, changedFields);
}

function controlledScalarFields(spec) {
  const allowed = new Set(Object.keys(spec.optionalTopLevel));
  allowed.add("title");
  const requiredControlled = CONTROLLED_REQUIRED_SCALARS_BY_KIND[spec.recordKind];
  if (requiredControlled) {
    for (const field of requiredControlled) {
      allowed.add(field);
    }
  }
  for (const managed of MANAGED_TOP_LEVEL_FIELDS) {
    allowed.delete(managed);
  }
  return allowed;
}

export function setScalar({ record, field, value, actor, now } = {}) {
  const guard = guardCommon(record, actor, now);
  if (!guard.ok) {
    return guard.refusal;
  }
  const { spec } = guard;
  if (!isNonEmptyString(field)) {
    return refusal(createDiagnostic("invalid_field", "field must be a non-empty string", { path: "field" }));
  }
  if (MANAGED_TOP_LEVEL_FIELDS.includes(field)) {
    return refusal(
      createDiagnostic(
        "managed_field",
        `Field '${field}' is lifecycle/provenance-managed; status flips via ratify/unratify and updated/updated_by are stamped automatically`,
        { path: "field" }
      )
    );
  }
  const allowed = controlledScalarFields(spec);
  if (!allowed.has(field)) {
    return refusal(
      createDiagnostic(
        "unsupported_field",
        `Unsupported scalar field '${field}' for ${spec.recordKind}; expected one of: ${[...allowed].join(", ")}`,
        { path: "field" }
      )
    );
  }
  const accepted = amendOfAcceptedRefusal(record);
  if (accepted) {
    return accepted;
  }

  const clone = cloneJson(record);
  clone[field] = cloneJson(value);
  const changedFields = [field];
  stampProvenance(clone, actor, now, changedFields);
  return finalizeEdit(clone, changedFields);
}

export function ratify({ record, actor, now } = {}) {
  const guard = guardCommon(record, actor, now);
  if (!guard.ok) {
    return guard.refusal;
  }
  if (record.record_kind !== "decision") {
    return refusal(
      createDiagnostic("unsupported_lifecycle", "ratify applies only to decision records", { path: "record_kind" })
    );
  }
  if (record.status !== "proposed") {
    return refusal(
      createDiagnostic(
        "invalid_lifecycle_transition",
        `ratify requires status 'proposed'; record is '${record.status}'`,
        { path: "status" }
      )
    );
  }

  const clone = cloneJson(record);
  clone.status = "accepted";
  clone.ratified = now;
  clone.ratified_by = actor;
  const changedFields = ["status", "ratified", "ratified_by"];
  stampProvenance(clone, actor, now, changedFields);
  return finalizeEdit(clone, changedFields);
}

export function unratify({ record, actor, now } = {}) {
  const guard = guardCommon(record, actor, now);
  if (!guard.ok) {
    return guard.refusal;
  }
  if (record.record_kind !== "decision") {
    return refusal(
      createDiagnostic("unsupported_lifecycle", "unratify applies only to decision records", { path: "record_kind" })
    );
  }
  if (record.status !== "accepted") {
    return refusal(
      createDiagnostic(
        "invalid_lifecycle_transition",
        `unratify requires status 'accepted'; record is '${record.status}'`,
        { path: "status" }
      )
    );
  }

  const clone = cloneJson(record);
  clone.status = "proposed";
  clone.ratified = null;
  clone.ratified_by = null;
  const changedFields = ["status", "ratified", "ratified_by"];
  stampProvenance(clone, actor, now, changedFields);
  return finalizeEdit(clone, changedFields);
}

export function reject({ record, actor, now } = {}) {
  const guard = guardCommon(record, actor, now);
  if (!guard.ok) {
    return guard.refusal;
  }
  if (record.record_kind !== "decision") {
    return refusal(
      createDiagnostic("unsupported_lifecycle", "reject applies only to decision records", { path: "record_kind" })
    );
  }
  if (record.status !== "proposed") {
    return refusal(
      createDiagnostic(
        "invalid_lifecycle_transition",
        `reject requires status 'proposed'; record is '${record.status}'`,
        { path: "status" }
      )
    );
  }

  const clone = cloneJson(record);
  clone.status = "rejected";
  const changedFields = ["status"];
  stampProvenance(clone, actor, now, changedFields);
  return finalizeEdit(clone, changedFields);
}

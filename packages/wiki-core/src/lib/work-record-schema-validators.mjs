

import {
  WORK_UNIT_FACET_PROVENANCE_VALUES,
  WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES
} from "./work-record-schema-constants.mjs";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isNullableString(value) {
  return value === null || isString(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

function isNullableStringArray(value) {
  return value == null || isStringArray(value);
}

function createDiagnostic(code, message, { severity = "error", path = null } = {}) {
  return { code, severity, message, path };
}

function addDiagnostic(diagnostics, code, message, options = {}) {
  diagnostics.push(createDiagnostic(code, message, options));
}

function validateEnumField(diagnostics, record, field, allowedValues, { path = field } = {}) {
  if (!hasOwn(record, field)) {
    return;
  }
  if (!allowedValues.includes(record[field])) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path} must be one of: ${allowedValues.map((value) => JSON.stringify(value)).join(", ")}`,
      { path }
    );
  }
}

function validateControlledStringField(
  diagnostics,
  record,
  field,
  allowedValues,
  { path = field, allowNull = false } = {}
) {
  if (!hasOwn(record, field)) {
    return;
  }
  const value = record[field];
  if (value === null) {
    if (allowNull) {
      return;
    }
    addDiagnostic(diagnostics, "invalid_record", `${path} must be a string`, { path });
    return;
  }
  if (!isString(value)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be a string`, { path });
    return;
  }
  if (!allowedValues.includes(value)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path} must be one of: ${allowedValues.join(", ")}`,
      { path }
    );
  }
}

function validateFacetProvenance(diagnostics, provenance, path) {
  if (provenance === null || provenance === undefined) {
    return;
  }
  if (!isObject(provenance)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  for (const [field, value] of Object.entries(provenance)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (!isString(value)) {
      addDiagnostic(diagnostics, "invalid_record", `${path}.${field} must be a string`, {
        path: `${path}.${field}`
      });
      continue;
    }
    if (!WORK_UNIT_FACET_PROVENANCE_VALUES.includes(value)) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.${field} must be one of: ${WORK_UNIT_FACET_PROVENANCE_VALUES.join(", ")}`,
        { path: `${path}.${field}` }
      );
    }
  }
}

function validateAcceptanceCriterionEntry(diagnostics, entry, path, { allowString = false } = {}) {
  if (isString(entry)) {
    if (allowString) {
      return;
    }
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }
  if (!isObject(entry)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be a string or object`, { path });
    return;
  }

  validateStringField(diagnostics, entry, "text", { path: `${path}.text`, allowEmpty: false });
  validateControlledStringField(
    diagnostics,
    entry,
    "verification_method",
    WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES,
    { path: `${path}.verification_method`, allowNull: true }
  );
  validateNullableStringField(diagnostics, entry, "evidence_target", {
    path: `${path}.evidence_target`
  });
  if (hasOwn(entry, "facet_provenance")) {
    validateFacetProvenance(diagnostics, entry.facet_provenance, `${path}.facet_provenance`);
  }
}

function validateStringField(
  diagnostics,
  record,
  field,
  { path = field, required = true, allowEmpty = true } = {}
) {
  if (!hasOwn(record, field)) {
    if (required) {
      addDiagnostic(diagnostics, "invalid_record", `${path} is required`, { path });
    }
    return false;
  }
  if (!isString(record[field])) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be a string`, { path });
    return false;
  }
  if (!allowEmpty && record[field].trim() === "") {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be a non-empty string`, {
      path
    });
    return false;
  }
  return true;
}

function validateStringArrayField(
  diagnostics,
  record,
  field,
  { path = field, required = true } = {}
) {
  if (!hasOwn(record, field)) {
    if (required) {
      addDiagnostic(diagnostics, "invalid_record", `${path} is required`, { path });
    }
    return false;
  }
  if (!isStringArray(record[field])) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an array of strings`, {
      path
    });
    return false;
  }
  return true;
}

function validateNullableStringField(diagnostics, record, field, { path = field } = {}) {
  if (!hasOwn(record, field)) {
    return true;
  }
  if (!isNullableString(record[field])) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be a string or null`, { path });
    return false;
  }
  return true;
}

function validateNullableNonNegativeIntegerField(
  diagnostics,
  record,
  field,
  { path = field, required = true } = {}
) {
  if (!hasOwn(record, field)) {
    if (required) {
      addDiagnostic(diagnostics, "invalid_record", `${path} is required`, { path });
    }
    return false;
  }
  const value = record[field];
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an integer or null`, {
      path
    });
    return false;
  }
  return true;
}

export {
  hasOwn,
  isObject,
  isString,
  isNullableString,
  isStringArray,
  isNullableStringArray,
  createDiagnostic,
  addDiagnostic,
  validateEnumField,
  validateControlledStringField,
  validateFacetProvenance,
  validateAcceptanceCriterionEntry,
  validateStringField,
  validateStringArrayField,
  validateNullableStringField,
  validateNullableNonNegativeIntegerField
};

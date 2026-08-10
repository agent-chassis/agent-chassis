import { createHash } from "node:crypto";

const BINDING_SET_VERSION =
  "controlled-contract-exact-binding-set.experimental.v0.1";
const BINDING_RESULT_VERSION =
  "controlled-contract-exact-binding-result.experimental.v0.1";

const BINDING_KINDS = new Set([
  "artifact_bytes",
  "complete_reachability_snapshot",
  "observed_execution_mutation_snapshot"
]);
const BINDING_PROJECTIONS = new Set([
  "artifact_subject",
  "snapshot_subject",
  "snapshot_population"
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9-]*$/u;
const ROLE = /^[a-z][a-z0-9_]*$/u;
const REFERENCE_ID = /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const PROFILE_EXTENSION_KEYS = new Set([
  "schema_version",
  "exact_binding_requirements",
  "distinct_capture_requirement_sets"
]);
const REQUIREMENT_KEYS = new Set([
  "requirement_id", "binding_kind", "expected_content_sha256", "role_coverage"
]);
const PROFILE_COVERAGE_KEYS = new Set(["role", "coverage", "projection"]);
const EVALUATION_INPUT_KEYS = new Set(["reference_bindings"]);
const REFERENCE_BINDING_KEYS = new Set(["role", "reference_ids"]);
const BINDING_SET_KEYS = new Set(["binding_set_version", "context", "bindings"]);
const CONTEXT_KEYS = new Set([
  "contract_sha256", "profile_sha256", "evaluation_input_sha256"
]);
const BINDING_KEYS = new Set([
  "binding_id", "requirement_id", "capture_id", "binding_kind", "media_type",
  "content_sha256", "byte_length", "role_coverage"
]);
const BINDING_COVERAGE_KEYS = new Set(["role", "projection", "reference_ids"]);

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matches(pattern, value) {
  return typeof value === "string" && pattern.test(value);
}

function diagnosticKey(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return `bigint:${item}`;
    if (typeof item === "symbol") return `symbol:${item.description ?? ""}`;
    if (typeof item === "function") return "function";
    return item;
  });
}

function canonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical_json_number_invalid");
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== "object") {
    throw new Error("canonical_json_value_invalid");
  }
  if (seen.has(value)) throw new Error("canonical_json_cycle_refused");
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new Error("canonical_json_array_invalid");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)) ||
        Object.keys(value).length !== value.length) {
      throw new Error("canonical_json_array_shape_invalid");
    }
    seen.add(value);
    try {
      return value.map((item) => canonicalValue(item, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("canonical_json_object_invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error("canonical_json_symbol_key_refused");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error("canonical_json_property_invalid");
    }
  }
  seen.add(value);
  try {
    return Object.fromEntries(
      keys.sort(compareCodeUnits).map((key) => [key, canonicalValue(value[key], seen)])
    );
  } finally {
    seen.delete(value);
  }
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)), "utf8");
}

function canonicalJsonClone(value) {
  return freezeDeep(JSON.parse(canonicalBytes(value).toString("utf8")));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalReferenceIds(referenceIds) {
  return [...referenceIds].sort(compareCodeUnits);
}

function canonicalRoleCoverage(roleCoverage) {
  return roleCoverage.map((coverage) => ({
    role: coverage.role,
    projection: coverage.projection,
    reference_ids: canonicalReferenceIds(coverage.reference_ids)
  })).sort((left, right) => compareCodeUnits(left.role, right.role));
}

function unknownKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => !allowed.has(key)).sort(compareCodeUnits);
}

function addUnknownFieldDiagnostic(value, allowed, diagnostics, code, location) {
  const fields = unknownKeys(value, allowed);
  if (fields.length > 0) diagnostics.push({ code, location, fields });
}

function canonicalBinding(binding) {
  return {
    binding_id: binding.binding_id,
    requirement_id: binding.requirement_id,
    capture_id: binding.capture_id,
    binding_kind: binding.binding_kind,
    media_type: binding.media_type,
    content_sha256: binding.content_sha256,
    byte_length: binding.byte_length,
    role_coverage: canonicalRoleCoverage(binding.role_coverage)
  };
}

function canonicalBindingSet(bindingSet) {
  const value = {
    binding_set_version: bindingSet.binding_set_version,
    context: {
      contract_sha256: bindingSet.context.contract_sha256,
      profile_sha256: bindingSet.context.profile_sha256,
      evaluation_input_sha256: bindingSet.context.evaluation_input_sha256
    },
    bindings: bindingSet.bindings.map(canonicalBinding).sort(
      (left, right) => compareCodeUnits(left.binding_id, right.binding_id)
    )
  };
  return freezeDeep(value);
}

function bindingSetDigest(bindingSet) {
  return sha256(canonicalBytes(canonicalBindingSet(bindingSet)));
}

function validateCoverage(coverage, location, diagnostics) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    diagnostics.push({ code: "binding_role_coverage_invalid", location });
    return;
  }
  addUnknownFieldDiagnostic(
    coverage, BINDING_COVERAGE_KEYS, diagnostics,
    "binding_role_coverage_unknown_fields", location
  );
  if (!matches(ROLE, coverage.role)) diagnostics.push({
    code: "binding_role_invalid", location, role: coverage.role ?? null
  });
  if (!BINDING_PROJECTIONS.has(coverage.projection)) diagnostics.push({
    code: "binding_projection_invalid", location,
    projection: coverage.projection ?? null
  });
  const emptyPopulation = coverage.projection === "snapshot_population" &&
    Array.isArray(coverage.reference_ids) && coverage.reference_ids.length === 0;
  const subjectCardinalityInvalid =
    ["artifact_subject", "snapshot_subject"].includes(coverage.projection) &&
    Array.isArray(coverage.reference_ids) && coverage.reference_ids.length !== 1;
  if (!Array.isArray(coverage.reference_ids) ||
      (!emptyPopulation && coverage.reference_ids.length === 0) ||
      subjectCardinalityInvalid ||
      coverage.reference_ids.some((id) => typeof id !== "string")) diagnostics.push({
    code: "binding_reference_ids_invalid", location
  });
  else if (new Set(coverage.reference_ids).size !== coverage.reference_ids.length) {
    diagnostics.push({ code: "binding_reference_ids_duplicate", location });
  }
}

function projectionAllowedForKind(kind, projection) {
  return kind === "artifact_bytes"
    ? projection === "artifact_subject"
    : ["snapshot_subject", "snapshot_population"].includes(projection);
}

function validateBindingSet(bindingSet) {
  const diagnostics = [];
  if (!bindingSet || typeof bindingSet !== "object" || Array.isArray(bindingSet)) return [{
    code: "binding_set_invalid"
  }];
  addUnknownFieldDiagnostic(
    bindingSet, BINDING_SET_KEYS, diagnostics, "binding_set_unknown_fields", "binding_set"
  );
  if (bindingSet.binding_set_version !== BINDING_SET_VERSION) diagnostics.push({
    code: "binding_set_version_invalid",
    actual: bindingSet.binding_set_version ?? null
  });
  if (!bindingSet.context || typeof bindingSet.context !== "object" ||
      Array.isArray(bindingSet.context)) {
    diagnostics.push({ code: "binding_context_invalid" });
  } else addUnknownFieldDiagnostic(
    bindingSet.context, CONTEXT_KEYS, diagnostics,
    "binding_context_unknown_fields", "binding_set.context"
  );
  for (const field of CONTEXT_KEYS) {
    if (!matches(SHA256, bindingSet.context?.[field])) diagnostics.push({
      code: "binding_context_digest_invalid", field
    });
  }
  if (!Array.isArray(bindingSet.bindings)) diagnostics.push({
    code: "bindings_invalid"
  });
  else {
    const bindingIds = new Set();
    const requirementIds = new Set();
    const captureCoverage = new Set();
    for (const [index, binding] of bindingSet.bindings.entries()) {
      const location = `bindings[${index}]`;
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
        diagnostics.push({ code: "binding_invalid", location });
        continue;
      }
      addUnknownFieldDiagnostic(
        binding, BINDING_KEYS, diagnostics, "binding_unknown_fields", location
      );
      for (const [field, pattern] of [
        ["binding_id", ID], ["requirement_id", ID], ["capture_id", ID]
      ]) {
        if (!matches(pattern, binding[field])) diagnostics.push({
          code: "binding_identifier_invalid", location, field
        });
      }
      if (bindingIds.has(binding.binding_id)) diagnostics.push({
        code: "binding_id_duplicate", binding_id: binding.binding_id
      });
      bindingIds.add(binding.binding_id);
      if (requirementIds.has(binding.requirement_id)) diagnostics.push({
        code: "binding_requirement_duplicate", requirement_id: binding.requirement_id
      });
      requirementIds.add(binding.requirement_id);
      if (!BINDING_KINDS.has(binding.binding_kind)) diagnostics.push({
        code: "binding_kind_invalid", location, binding_kind: binding.binding_kind ?? null
      });
      if (typeof binding.media_type !== "string" || binding.media_type.length === 0) {
        diagnostics.push({ code: "binding_media_type_invalid", location });
      }
      if (!matches(SHA256, binding.content_sha256)) diagnostics.push({
        code: "binding_content_digest_invalid", location
      });
      if (!Number.isSafeInteger(binding.byte_length) || binding.byte_length < 0) {
        diagnostics.push({ code: "binding_byte_length_invalid", location });
      }
      if (!Array.isArray(binding.role_coverage) || binding.role_coverage.length === 0) {
        diagnostics.push({ code: "binding_role_coverage_empty", location });
      } else {
        const roles = new Set();
        for (const [coverageIndex, coverage] of binding.role_coverage.entries()) {
          validateCoverage(coverage, `${location}.role_coverage[${coverageIndex}]`, diagnostics);
          if (!projectionAllowedForKind(binding.binding_kind, coverage?.projection)) {
            diagnostics.push({
              code: "binding_projection_kind_mismatch", location,
              projection: coverage?.projection ?? null
            });
          }
          if (roles.has(coverage?.role)) diagnostics.push({
            code: "binding_role_coverage_duplicate", location, role: coverage?.role
          });
          roles.add(coverage?.role);
          const referenceIds = Array.isArray(coverage?.reference_ids)
            ? coverage.reference_ids
            : [];
          for (const referenceId of referenceIds) {
            const key = `${binding.capture_id}\u0000${coverage.role}\u0000${referenceId}`;
            if (captureCoverage.has(key)) diagnostics.push({
              code: "capture_role_reference_duplicate",
              capture_id: binding.capture_id,
              role: coverage.role,
              reference_id: referenceId
            });
            captureCoverage.add(key);
          }
        }
      }
    }
  }
  return diagnostics.sort((left, right) =>
    compareCodeUnits(diagnosticKey(left), diagnosticKey(right))
  );
}

function validateRequirements(profile) {
  const diagnostics = [];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return [{
    code: "binding_profile_extension_invalid"
  }];
  addUnknownFieldDiagnostic(
    profile, PROFILE_EXTENSION_KEYS, diagnostics,
    "binding_profile_extension_unknown_fields", "profile"
  );
  if (profile.schema_version !== undefined &&
      profile.schema_version !== "controlled-contract-verification-profile.experimental.v0.2") {
    diagnostics.push({ code: "binding_profile_schema_version_invalid" });
  }
  const requirements = profile?.exact_binding_requirements;
  if (!Array.isArray(requirements)) return [{ code: "binding_requirements_missing" }];
  const ids = new Set();
  for (const [index, requirement] of requirements.entries()) {
    const location = `exact_binding_requirements[${index}]`;
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      diagnostics.push({ code: "binding_requirement_invalid", location });
      continue;
    }
    addUnknownFieldDiagnostic(
      requirement, REQUIREMENT_KEYS, diagnostics,
      "binding_requirement_unknown_fields", location
    );
    if (!matches(ID, requirement.requirement_id)) diagnostics.push({
      code: "binding_requirement_id_invalid", location
    });
    if (ids.has(requirement?.requirement_id)) diagnostics.push({
      code: "binding_requirement_id_duplicate",
      requirement_id: requirement?.requirement_id
    });
    ids.add(requirement?.requirement_id);
    if (!BINDING_KINDS.has(requirement?.binding_kind)) diagnostics.push({
      code: "binding_requirement_kind_invalid", location
    });
    if (requirement?.expected_content_sha256 !== undefined &&
        !matches(SHA256, requirement.expected_content_sha256)) diagnostics.push({
      code: "binding_requirement_expected_digest_invalid", location
    });
    if (!Array.isArray(requirement?.role_coverage) ||
        requirement.role_coverage.length === 0) diagnostics.push({
      code: "binding_requirement_coverage_empty", location
    });
    else {
      const roles = new Set();
      for (const [coverageIndex, coverage] of requirement.role_coverage.entries()) {
        const coverageLocation = `${location}.role_coverage[${coverageIndex}]`;
        if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
          diagnostics.push({
            code: "binding_requirement_coverage_invalid",
            location: coverageLocation
          });
          continue;
        }
        addUnknownFieldDiagnostic(
          coverage, PROFILE_COVERAGE_KEYS, diagnostics,
          "binding_requirement_coverage_unknown_fields", coverageLocation
        );
        if (!matches(ROLE, coverage.role) || coverage.coverage !== "exact" ||
            !BINDING_PROJECTIONS.has(coverage?.projection)) {
          diagnostics.push({
            code: "binding_requirement_coverage_invalid",
            location: coverageLocation
          });
        }
        if (!projectionAllowedForKind(requirement?.binding_kind, coverage?.projection)) {
          diagnostics.push({
            code: "binding_requirement_projection_kind_mismatch",
            location: `${location}.role_coverage[${coverageIndex}]`
          });
        }
        if (roles.has(coverage?.role)) diagnostics.push({
          code: "binding_requirement_role_duplicate", location, role: coverage?.role
        });
        roles.add(coverage?.role);
      }
    }
  }
  const distinctSets = profile.distinct_capture_requirement_sets ?? [];
  if (!Array.isArray(distinctSets)) diagnostics.push({
    code: "distinct_capture_requirement_sets_invalid"
  });
  for (const [index, set] of (Array.isArray(distinctSets) ? distinctSets : []).entries()) {
    if (!Array.isArray(set) || set.length < 2 || new Set(set).size !== set.length ||
        set.some((id) => !ids.has(id))) diagnostics.push({
      code: "distinct_capture_requirement_set_invalid", index
    });
  }
  return diagnostics.sort((left, right) =>
    compareCodeUnits(diagnosticKey(left), diagnosticKey(right))
  );
}

function validateEvaluationInputReferenceBindings(evaluationInput) {
  const diagnostics = [];
  if (!evaluationInput || typeof evaluationInput !== "object" ||
      Array.isArray(evaluationInput)) return [{ code: "evaluation_input_invalid" }];
  addUnknownFieldDiagnostic(
    evaluationInput, EVALUATION_INPUT_KEYS, diagnostics,
    "evaluation_input_unknown_fields", "evaluation_input"
  );
  if (!Array.isArray(evaluationInput.reference_bindings)) return [{
    code: "evaluation_reference_bindings_invalid"
  }];
  const roles = new Set();
  for (const [index, binding] of evaluationInput.reference_bindings.entries()) {
    const location = `reference_bindings[${index}]`;
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      diagnostics.push({ code: "evaluation_reference_binding_invalid", location });
      continue;
    }
    addUnknownFieldDiagnostic(
      binding, REFERENCE_BINDING_KEYS, diagnostics,
      "evaluation_reference_binding_unknown_fields", location
    );
    if (!matches(ROLE, binding.role)) diagnostics.push({
      code: "evaluation_reference_role_invalid", location
    });
    if (roles.has(binding.role)) diagnostics.push({
      code: "evaluation_reference_role_duplicate", role: binding.role
    });
    roles.add(binding.role);
    if (!Array.isArray(binding.reference_ids) ||
        binding.reference_ids.some((id) => !matches(REFERENCE_ID, id))) {
      diagnostics.push({ code: "evaluation_reference_ids_invalid", location });
    } else if (new Set(binding.reference_ids).size !== binding.reference_ids.length) {
      diagnostics.push({ code: "evaluation_reference_ids_duplicate", location });
    }
  }
  return diagnostics.sort((left, right) =>
    compareCodeUnits(diagnosticKey(left), diagnosticKey(right))
  );
}

function referenceBindingsByRole(evaluationInput) {
  const result = new Map();
  for (const binding of evaluationInput.reference_bindings) {
    result.set(binding.role, canonicalReferenceIds(binding.reference_ids ?? []));
  }
  return result;
}

function evaluateExactBindingsV034({
  profile,
  evaluation_input: evaluationInput,
  contract_reference_ids: contractReferenceIds,
  input_digests: inputDigests,
  binding_set: bindingSet
}) {
  const requirementDiagnostics = validateRequirements(profile);
  const evaluationInputDiagnostics = validateEvaluationInputReferenceBindings(
    evaluationInput
  );
  const bindingSetDiagnostics = validateBindingSet(bindingSet);
  const structuralDiagnostics = [
    ...requirementDiagnostics,
    ...evaluationInputDiagnostics,
    ...bindingSetDiagnostics
  ];
  const validContractReferenceIds = Array.isArray(contractReferenceIds) &&
    contractReferenceIds.every((id) => matches(REFERENCE_ID, id));
  const normalizedContractReferenceIds = validContractReferenceIds
    ? contractReferenceIds
    : [];
  if (!validContractReferenceIds) structuralDiagnostics.push({
    code: "contract_reference_ids_invalid"
  });
  const knownReferenceIds = new Set(normalizedContractReferenceIds);
  if (knownReferenceIds.size !== normalizedContractReferenceIds.length) {
    structuralDiagnostics.push({ code: "contract_reference_id_duplicate" });
  }
  for (const field of ["contract_sha256", "profile_sha256", "evaluation_input_sha256"]) {
    if (!matches(SHA256, inputDigests?.[field])) structuralDiagnostics.push({
      code: "input_digest_invalid", field
    });
    else if (bindingSet?.context?.[field] !== inputDigests[field]) {
      structuralDiagnostics.push({
        code: "binding_context_stale_or_spliced",
        field,
        expected: inputDigests[field],
        actual: bindingSet?.context?.[field] ?? null
      });
    }
  }
  const roleBindings = evaluationInputDiagnostics.length === 0
    ? referenceBindingsByRole(evaluationInput)
    : new Map();
  if (structuralDiagnostics.length > 0) return freezeDeep({
    result_version: BINDING_RESULT_VERSION,
    authority: { kind: "free_tier_local", authoritative: false },
    admission: { kind: "unadmitted_direct", capture_verified: false },
    satisfaction: "invalid",
    binding_set_sha256: bindingSetDiagnostics.length === 0
      ? bindingSetDigest(bindingSet)
      : null,
    bindings: bindingSetDiagnostics.length === 0
      ? canonicalBindingSet(bindingSet).bindings
      : [],
    diagnostics: structuralDiagnostics.sort((left, right) =>
      compareCodeUnits(diagnosticKey(left), diagnosticKey(right))
    )
  });

  const diagnostics = [];
  const requirements = new Map(profile.exact_binding_requirements.map(
    (requirement) => [requirement.requirement_id, requirement]
  ));
  const bindings = new Map(bindingSet.bindings.map(
    (binding) => [binding.requirement_id, binding]
  ));
  for (const binding of bindingSet.bindings) {
    if (!requirements.has(binding.requirement_id)) diagnostics.push({
      code: "binding_orphaned", requirement_id: binding.requirement_id
    });
  }
  for (const requirement of profile.exact_binding_requirements) {
    const binding = bindings.get(requirement.requirement_id);
    if (!binding) {
      diagnostics.push({
        code: "required_binding_missing",
        requirement_id: requirement.requirement_id
      });
      continue;
    }
    if (binding.binding_kind !== requirement.binding_kind) diagnostics.push({
      code: "required_binding_kind_mismatch",
      requirement_id: requirement.requirement_id,
      expected: requirement.binding_kind,
      actual: binding.binding_kind
    });
    if (requirement.expected_content_sha256 !== undefined &&
        binding.content_sha256 !== requirement.expected_content_sha256) diagnostics.push({
      code: "required_binding_content_digest_mismatch",
      requirement_id: requirement.requirement_id,
      expected: requirement.expected_content_sha256,
      actual: binding.content_sha256
    });
    const coverageByRole = new Map(binding.role_coverage.map(
      (coverage) => [coverage.role, {
        projection: coverage.projection,
        reference_ids: canonicalReferenceIds(coverage.reference_ids)
      }]
    ));
    const requiredRoles = new Set(requirement.role_coverage.map(({ role }) => role));
    for (const coveredRole of coverageByRole.keys()) {
      if (!requiredRoles.has(coveredRole)) diagnostics.push({
        code: "binding_role_coverage_extra",
        requirement_id: requirement.requirement_id,
        role: coveredRole
      });
    }
    for (const { role, projection } of requirement.role_coverage) {
      const expected = roleBindings.get(role);
      const actualCoverage = coverageByRole.get(role);
      const actual = actualCoverage?.reference_ids;
      if (!expected) diagnostics.push({
        code: "binding_role_unbound",
        requirement_id: requirement.requirement_id,
        role
      });
      else if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
        diagnostics.push({
          code: "binding_role_coverage_mismatch",
          requirement_id: requirement.requirement_id,
          role,
          expected_reference_ids: expected,
          actual_reference_ids: actual ?? []
        });
      }
      if (actualCoverage && actualCoverage.projection !== projection) diagnostics.push({
        code: "binding_role_projection_mismatch",
        requirement_id: requirement.requirement_id,
        role,
        expected_projection: projection,
        actual_projection: actualCoverage.projection
      });
      for (const referenceId of actual ?? []) {
        if (!knownReferenceIds.has(referenceId)) diagnostics.push({
          code: "binding_reference_not_declared",
          requirement_id: requirement.requirement_id,
          role,
          reference_id: referenceId
        });
      }
    }
  }
  for (const requirementSet of profile.distinct_capture_requirement_sets ?? []) {
    const captures = requirementSet.map((id) => bindings.get(id)?.capture_id);
    if (captures.every(Boolean) && new Set(captures).size !== captures.length) diagnostics.push({
      code: "distinct_capture_requirement_violated",
      requirement_ids: requirementSet,
      capture_ids: captures
    });
  }
  const missing = diagnostics.some(({ code }) => code === "required_binding_missing");
  const satisfaction = diagnostics.length === 0
    ? "satisfied"
    : missing ? "indeterminate" : "unsatisfied";
  return freezeDeep({
    result_version: BINDING_RESULT_VERSION,
    authority: { kind: "free_tier_local", authoritative: false },
    admission: { kind: "unadmitted_direct", capture_verified: false },
    satisfaction,
    binding_set_sha256: bindingSetDigest(bindingSet),
    bindings: canonicalBindingSet(bindingSet).bindings,
    diagnostics: diagnostics.sort((left, right) =>
      compareCodeUnits(diagnosticKey(left), diagnosticKey(right))
    )
  });
}

export {
  BINDING_KINDS,
  BINDING_PROJECTIONS,
  BINDING_RESULT_VERSION,
  BINDING_SET_VERSION,
  bindingSetDigest,
  canonicalBindingSet,
  canonicalBytes,
  canonicalJsonClone,
  canonicalRoleCoverage,
  evaluateExactBindingsV034,
  freezeDeep,
  sha256,
  validateBindingSet,
  validateEvaluationInputReferenceBindings,
  validateRequirements
};

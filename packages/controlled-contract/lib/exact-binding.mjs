import {
  ExactBindingError,
  assertSchema,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  sha256,
  sortedUnique
} from "./exact-binding-common.mjs";
import {
  assertCanonicalProjectionResult,
  executeDeterministicProjection,
  validateDeterministicProjectionPopulation,
  validateDeterministicProjectionRelation
} from "./deterministic-projection.mjs";

const RESULT_VERSION = "controlled-contract-exact-binding-result.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/u;
const CONTEXT_FIELDS = Object.freeze([
  "contract_digest",
  "profile_digest",
  "evaluation_input_digest",
  "vocabulary_version",
  "vocabulary_complete_digest",
  "admission_digest",
  "exact_binding_declaration_digest",
  "exact_binding_certification_digest"
]);
const BINDING_FIELDS = new Set([
  "binding_id", "requirement_id", "capture_id", "binding_kind", "media_type",
  "content_sha256", "source_descriptor_sha256", "byte_length", "role_coverage"
]);
const REQUIRED_BINDING_FIELDS = new Set([
  "binding_id", "requirement_id", "capture_id", "binding_kind", "media_type",
  "content_sha256", "byte_length", "role_coverage"
]);
const COVERAGE_FIELDS = new Set([
  "role", "coverage", "projection", "population_id", "reference_ids"
]);
const REQUIRED_COVERAGE_FIELDS = Object.freeze([
  "role", "coverage", "projection", "reference_ids"
]);
const INTERNAL_CAPTURE_AUTHORITY = Symbol("exact-binding-internal-capture-authority");
const CAPTURED_RESULTS = new WeakSet();

function diagnostic(code, message, fields = {}) {
  return { code, message, ...fields };
}

function diagnosticsOrder(left, right) {
  return compareCodeUnits(JSON.stringify(left), JSON.stringify(right));
}

function semanticDeclarationDiagnostics(declaration) {
  const diagnostics = [];
  try {
    assertSchema(
      "controlled-contract-exact-binding-declaration.v1.schema.json",
      declaration,
      "exact_binding_declaration_schema_invalid"
    );
  } catch (error) {
    return [diagnostic(
      "exact_binding_declaration_schema_invalid",
      "exact-binding declaration does not satisfy its closed schema"
    )];
  }
  const requirements = declaration.requirements;
  const relations = declaration.relations;
  const requirementIds = requirements.map(({ requirement_id: id }) => id);
  const relationIds = relations.map(({ relation_id: id }) => id);
  if (new Set(requirementIds).size !== requirementIds.length) diagnostics.push(diagnostic(
    "requirement_id_duplicate", "requirement identifiers must be unique"
  ));
  if (new Set(relationIds).size !== relationIds.length) diagnostics.push(diagnostic(
    "relation_id_duplicate", "relation identifiers must be unique"
  ));
  if (!sortedUnique(requirementIds)) diagnostics.push(diagnostic(
    "requirement_order_noncanonical",
    "requirements must be uniquely ordered by UTF-16 code units"
  ));
  if (relationIds.length > 0 && !sortedUnique(relationIds)) diagnostics.push(diagnostic(
    "relation_order_noncanonical", "relations must be ordered by UTF-16 code units"
  ));
  const declared = new Set(requirementIds);
  for (const requirement of requirements) {
    const roles = requirement.role_coverage.map(({ role }) => role);
    if (!sortedUnique(roles)) diagnostics.push(diagnostic(
      "role_coverage_order_noncanonical",
      "requirement role coverage must be uniquely ordered by role",
      { requirement_id: requirement.requirement_id }
    ));
    for (const coverage of requirement.role_coverage) {
      const allowed = requirement.binding_kind === "artifact_bytes"
        ? ["artifact_subject", "projection_result_population"].includes(
          coverage.projection
        )
        : ["snapshot_subject", "snapshot_population"].includes(coverage.projection);
      if (!allowed) diagnostics.push(diagnostic(
        "projection_kind_mismatch",
        "coverage projection is not allowed for the declared binding kind",
        { requirement_id: requirement.requirement_id }
      ));
      if (coverage.projection === "projection_result_population") {
        const owningRelations = relations.filter(({ operator, result_requirement_id: id }) =>
          operator === "deterministic_projection" && id === requirement.requirement_id
        );
        if (owningRelations.length !== 1 || typeof coverage.population_id !== "string") {
          diagnostics.push(diagnostic(
            "projection_population_coverage_invalid",
            "projection-result population coverage needs one owning projection and a population id",
            { requirement_id: requirement.requirement_id }
          ));
        } else diagnostics.push(...validateDeterministicProjectionPopulation(
          owningRelations[0].transformer_id, coverage.population_id
        ).map((entry) => ({ ...entry, requirement_id: requirement.requirement_id })));
      } else if (coverage.population_id !== undefined) diagnostics.push(diagnostic(
        "projection_population_coverage_invalid",
        "population_id is allowed only for projection-result population coverage",
        { requirement_id: requirement.requirement_id }
      ));
    }
  }
  for (const relation of relations) {
    const operandIds = relation.operator === "deterministic_projection"
      ? [...relation.source_requirement_ids, relation.result_requirement_id]
      : relation.requirement_ids;
    if (operandIds.some((id) => !declared.has(id))) {
      diagnostics.push(diagnostic(
        "relation_operand_undeclared", "relation operand is not a declared requirement",
        { relation_id: relation.relation_id }
      ));
    }
    if (relation.operator !== "deterministic_projection" &&
        !sortedUnique(relation.requirement_ids)) diagnostics.push(diagnostic(
      "relation_operand_order_noncanonical",
      "relation operands must be distinct and ordered by UTF-16 code units",
      { relation_id: relation.relation_id }
    ));
    if (relation.operator === "deterministic_projection") {
      if (new Set(relation.source_requirement_ids).size !==
          relation.source_requirement_ids.length ||
          relation.source_requirement_ids.includes(relation.result_requirement_id)) {
        diagnostics.push(diagnostic(
          "projection_relation_operands_invalid",
          "projection sources must be unique and distinct from the result",
          { relation_id: relation.relation_id }
        ));
      }
      const requirementsById = new Map(requirements.map((requirement) => [
        requirement.requirement_id, requirement
      ]));
      if (operandIds.some((id) =>
        requirementsById.get(id)?.binding_kind !== "artifact_bytes")) {
        diagnostics.push(diagnostic(
          "projection_relation_binding_kind_invalid",
          "deterministic projections require captured artifact bytes",
          { relation_id: relation.relation_id }
        ));
      }
      diagnostics.push(...validateDeterministicProjectionRelation(relation));
    }
  }
  return diagnostics.sort(diagnosticsOrder);
}

function assertCanonicalDeclarationFile(rawBytes) {
  let declaration;
  try {
    declaration = JSON.parse(Buffer.from(rawBytes).toString("utf8"));
  } catch (error) {
    throw new ExactBindingError(
      "exact_binding_declaration_json_invalid",
      "exact-binding declaration is not valid JSON",
      { cause: error.message }
    );
  }
  const expected = canonicalJsonBytes(declaration, { file: true });
  if (!Buffer.from(rawBytes).equals(expected)) throw new ExactBindingError(
    "exact_binding_declaration_noncanonical",
    "exact-binding declaration bytes must be canonical JSON plus exactly one LF"
  );
  const diagnostics = semanticDeclarationDiagnostics(declaration);
  if (diagnostics.length > 0) throw new ExactBindingError(
    "exact_binding_declaration_invalid",
    "exact-binding declaration failed semantic validation",
    { diagnostics }
  );
  return deepFreeze(declaration);
}

function validateContext(context, expectedContext) {
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      Object.keys(context).length !== CONTEXT_FIELDS.length ||
      CONTEXT_FIELDS.some((field) => !Object.hasOwn(context, field))) {
    return [diagnostic("binding_context_invalid", "binding context is not closed")];
  }
  const diagnostics = [];
  for (const field of CONTEXT_FIELDS) {
    const valid = field === "vocabulary_version"
      ? typeof context[field] === "string" && context[field].length > 0
      : SHA256.test(context[field]);
    if (!valid) diagnostics.push(diagnostic(
      "binding_context_field_invalid", "binding context field is invalid"
    ));
    if (expectedContext && context[field] !== expectedContext[field]) diagnostics.push(diagnostic(
      "binding_context_stale_or_spliced",
      "binding context does not identify the assessment inputs"
    ));
  }
  return diagnostics;
}

function expectedReferenceMap(evaluationInput) {
  const result = new Map();
  for (const binding of evaluationInput?.reference_bindings ?? []) {
    if (typeof binding?.role !== "string" || !Array.isArray(binding.reference_ids) ||
        result.has(binding.role) || binding.reference_ids.some(
          (referenceId) => typeof referenceId !== "string"
        )) return null;
    result.set(binding.role, [...binding.reference_ids].sort(compareCodeUnits));
  }
  return result;
}

function validateBinding(binding, index) {
  const diagnostics = [];
  const invalid = (code, message) => diagnostics.push(diagnostic(
    code,
    message,
    ID.test(binding?.requirement_id ?? "")
      ? { requirement_id: binding.requirement_id } : {}
  ));
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    invalid("binding_invalid", `binding ${index} is not an object`);
    return diagnostics;
  }
  if (Object.keys(binding).some((key) => !BINDING_FIELDS.has(key)) ||
      [...REQUIRED_BINDING_FIELDS].some((key) => !Object.hasOwn(binding, key))) {
    invalid("binding_shape_invalid", "binding fields are not closed");
  }
  for (const field of ["binding_id", "requirement_id", "capture_id"]) {
    if (!ID.test(binding[field] ?? "")) invalid(
      "binding_identifier_invalid", `${field} is invalid`
    );
  }
  if (!["artifact_bytes", "complete_reachability_snapshot",
    "observed_execution_mutation_snapshot"].includes(binding.binding_kind)) {
    invalid("binding_kind_invalid", "binding kind is invalid");
  }
  if (typeof binding.media_type !== "string" || binding.media_type.length === 0) {
    invalid("binding_media_type_invalid", "binding media type is invalid");
  }
  if (!SHA256.test(binding.content_sha256 ?? "")) invalid(
    "binding_content_digest_invalid", "binding content digest is invalid"
  );
  if (binding.source_descriptor_sha256 !== undefined &&
      !SHA256.test(binding.source_descriptor_sha256)) invalid(
    "binding_source_descriptor_digest_invalid",
    "binding source descriptor digest is invalid"
  );
  if (!Number.isSafeInteger(binding.byte_length) || binding.byte_length < 0) invalid(
    "binding_byte_length_invalid", "binding byte length is invalid"
  );
  if (!Array.isArray(binding.role_coverage) || binding.role_coverage.length === 0) {
    invalid("binding_role_coverage_invalid", "binding role coverage is empty");
  } else {
    const roles = [];
    for (const coverage of binding.role_coverage) {
      if (!coverage || typeof coverage !== "object" || Array.isArray(coverage) ||
          Object.keys(coverage).some((key) => !COVERAGE_FIELDS.has(key)) ||
          REQUIRED_COVERAGE_FIELDS.some((key) => !Object.hasOwn(coverage, key)) ||
          !ID.test(coverage.role ?? "") || coverage.coverage !== "exact" ||
          !["artifact_subject", "snapshot_subject", "snapshot_population",
            "projection_result_population"]
            .includes(coverage.projection) ||
          (coverage.projection === "projection_result_population"
            ? !ID.test(coverage.population_id ?? "")
            : coverage.population_id !== undefined) ||
          !Array.isArray(coverage.reference_ids) ||
          !sortedUnique(coverage.reference_ids) ||
          (["artifact_subject", "snapshot_subject"].includes(coverage.projection) &&
            coverage.reference_ids.length !== 1)) {
        invalid("binding_role_coverage_invalid", "binding role coverage is invalid");
      } else roles.push(coverage.role);
    }
    if (!sortedUnique(roles)) invalid(
      "binding_role_coverage_order_invalid", "binding roles are not uniquely ordered"
    );
  }
  return diagnostics;
}

function canonicalBindings(bindings) {
  return [...bindings].map((binding) => ({
    ...binding,
    role_coverage: binding.role_coverage.map((coverage) => ({
      ...coverage,
      reference_ids: [...coverage.reference_ids].sort(compareCodeUnits)
    })).sort((left, right) => compareCodeUnits(left.role, right.role))
  })).sort((left, right) => compareCodeUnits(left.requirement_id, right.requirement_id));
}

function coreEvaluate({
  declaration,
  evaluationInput,
  context,
  expectedContext = context,
  bindings,
  internalCaptureFailure = null,
  capturedBytesByRequirement = null
}, captureVerified) {
  const diagnostics = [
    ...semanticDeclarationDiagnostics(declaration),
    ...validateContext(context, expectedContext)
  ];
  if (internalCaptureFailure) diagnostics.push(diagnostic(
    internalCaptureFailure.code,
    internalCaptureFailure.message,
    internalCaptureFailure.requirement_id
      ? { requirement_id: internalCaptureFailure.requirement_id } : {}
  ));
  const referenceMap = expectedReferenceMap(evaluationInput);
  if (!referenceMap) diagnostics.push(diagnostic(
    "evaluation_input_reference_bindings_invalid",
    "evaluation input role bindings are ambiguous or malformed"
  ));
  if (!Array.isArray(bindings)) diagnostics.push(diagnostic(
    "bindings_invalid", "bindings must be an array"
  ));
  else bindings.forEach((binding, index) => diagnostics.push(
    ...validateBinding(binding, index)
  ));

  const invalid = diagnostics.length > 0;
  const safeBindings = invalid || !Array.isArray(bindings) ? [] : canonicalBindings(bindings);
  const byRequirement = new Map();
  const bindingIds = new Set();
  if (!invalid) for (const binding of safeBindings) {
    if (byRequirement.has(binding.requirement_id)) diagnostics.push(diagnostic(
      "binding_requirement_duplicate", "a requirement has more than one binding",
      { requirement_id: binding.requirement_id }
    ));
    byRequirement.set(binding.requirement_id, binding);
    if (bindingIds.has(binding.binding_id)) diagnostics.push(diagnostic(
      "binding_id_duplicate", "binding identifiers must be unique",
      { requirement_id: binding.requirement_id }
    ));
    bindingIds.add(binding.binding_id);
  }

  let indeterminate = false;
  let unsatisfied = false;
  let relationInvalid = false;
  const relationResults = [];
  if (diagnostics.length === 0) {
    const declaredIds = new Set(declaration.requirements.map(
      ({ requirement_id: id }) => id
    ));
    for (const binding of safeBindings) if (!declaredIds.has(binding.requirement_id)) {
      diagnostics.push(diagnostic(
        "binding_requirement_extra", "binding names an undeclared requirement",
        { requirement_id: binding.requirement_id }
      ));
    }
    for (const requirement of declaration.requirements) {
      const binding = byRequirement.get(requirement.requirement_id);
      if (!binding) {
        indeterminate = true;
        diagnostics.push(diagnostic(
          "required_binding_missing", "required exact binding is missing",
          { requirement_id: requirement.requirement_id }
        ));
        continue;
      }
      if (binding.binding_kind !== requirement.binding_kind) {
        unsatisfied = true;
        diagnostics.push(diagnostic(
          "required_binding_kind_mismatch", "captured binding kind does not match",
          { requirement_id: requirement.requirement_id }
        ));
      }
      if (requirement.expected_content_sha256 !== undefined &&
          binding.content_sha256 !== requirement.expected_content_sha256) {
        unsatisfied = true;
        diagnostics.push(diagnostic(
          "expected_content_digest_mismatch", "captured bytes do not match the constraint",
          { requirement_id: requirement.requirement_id }
        ));
      }
      const actualCoverage = new Map(binding.role_coverage.map(
        (coverage) => [coverage.role, coverage]
      ));
      if (actualCoverage.size !== requirement.role_coverage.length) unsatisfied = true;
      for (const expectedCoverage of requirement.role_coverage) {
        const actual = actualCoverage.get(expectedCoverage.role);
        const expectedReferences = referenceMap?.get(expectedCoverage.role);
        if (!actual || actual.coverage !== "exact" ||
            actual.projection !== expectedCoverage.projection ||
            actual.population_id !== expectedCoverage.population_id ||
            !expectedReferences ||
            JSON.stringify(actual.reference_ids) !== JSON.stringify(expectedReferences)) {
          unsatisfied = true;
          diagnostics.push(diagnostic(
            "binding_role_coverage_mismatch",
            "captured role coverage does not match the full evaluation input",
            { requirement_id: requirement.requirement_id }
          ));
        }
      }
    }
    for (const relation of declaration.relations) {
      const relationRequirementIds = relation.operator === "deterministic_projection"
        ? [...relation.source_requirement_ids, relation.result_requirement_id]
        : relation.requirement_ids;
      const operands = relationRequirementIds.map((id) => byRequirement.get(id));
      if (operands.some((binding) => !binding)) continue;
      if (relation.operator === "same_content_sha256") {
        const observed = operands.map(({ content_sha256: digest }) => digest);
        const status = new Set(observed).size === 1 ? "satisfied" : "unsatisfied";
        if (status === "unsatisfied") unsatisfied = true;
        relationResults.push({
          relation_id: relation.relation_id,
          operator: relation.operator,
          requirement_ids: [...relation.requirement_ids],
          status,
          observed_content_sha256: observed
        });
      } else if (relation.operator === "distinct_capture_id") {
        const observed = operands.map(({ capture_id: captureId }) => captureId);
        const status = new Set(observed).size === observed.length
          ? "satisfied" : "unsatisfied";
        if (status === "unsatisfied") unsatisfied = true;
        relationResults.push({
          relation_id: relation.relation_id,
          operator: relation.operator,
          requirement_ids: [...relation.requirement_ids],
          status,
          observed_capture_ids: observed
        });
      } else if (relation.operator === "distinct_source_descriptor") {
        const observed = operands.map(
          ({ source_descriptor_sha256: digest }) => digest
        );
        if (observed.some((digest) => digest === undefined)) {
          relationInvalid = true;
          diagnostics.push(diagnostic(
            "source_descriptor_digest_missing",
            "distinct-source relation requires captured source descriptor digests",
            { relation_id: relation.relation_id }
          ));
          continue;
        }
        const status = new Set(observed).size === observed.length
          ? "satisfied" : "unsatisfied";
        if (status === "unsatisfied") unsatisfied = true;
        relationResults.push({
          relation_id: relation.relation_id,
          operator: relation.operator,
          requirement_ids: [...relation.requirement_ids],
          status,
          observed_source_descriptor_sha256: observed
        });
      } else if (!captureVerified || !(capturedBytesByRequirement instanceof Map)) {
        relationInvalid = true;
        diagnostics.push(diagnostic(
          "projection_direct_result_fabrication_refused",
          "deterministic projection relations require internal captured source and result bytes",
          { relation_id: relation.relation_id }
        ));
      } else {
        try {
          const sourceBytes = relation.source_requirement_ids.map((id) =>
            capturedBytesByRequirement.get(id));
          const resultBytes = capturedBytesByRequirement.get(relation.result_requirement_id);
          if (sourceBytes.some((bytes) => !Buffer.isBuffer(bytes)) ||
              !Buffer.isBuffer(resultBytes)) throw new ExactBindingError(
            "projection_source_set_incomplete",
            "captured deterministic projection bytes are incomplete"
          );
          for (const [index, requirementId] of relationRequirementIds.entries()) {
            const bytes = index < sourceBytes.length ? sourceBytes[index] : resultBytes;
            if (sha256(bytes) !== byRequirement.get(requirementId).content_sha256) {
              throw new ExactBindingError(
                "projection_source_result_splice",
                "projection bytes do not match their captured binding records"
              );
            }
          }
          assertCanonicalProjectionResult(resultBytes);
          const derivedBytes = executeDeterministicProjection(
            relation.transformer_id, sourceBytes
          );
          const status = derivedBytes.equals(resultBytes) ? "satisfied" : "unsatisfied";
          if (status === "unsatisfied") unsatisfied = true;
          relationResults.push({
            relation_id: relation.relation_id,
            operator: relation.operator,
            transformer_id: relation.transformer_id,
            source_requirement_ids: [...relation.source_requirement_ids],
            result_requirement_id: relation.result_requirement_id,
            status,
            observed_source_content_sha256: sourceBytes.map(sha256),
            observed_result_content_sha256: sha256(resultBytes),
            derived_content_sha256: sha256(derivedBytes)
          });
        } catch (error) {
          relationInvalid = true;
          diagnostics.push(diagnostic(
            ID.test(error?.code ?? "") ? error.code : "projection_execution_failed",
            error?.message ?? "deterministic projection execution failed",
            { relation_id: relation.relation_id }
          ));
        }
      }
    }
  }

  const becameInvalid = diagnostics.some(({ code }) => [
    "binding_requirement_extra", "binding_requirement_duplicate", "binding_id_duplicate"
  ].includes(code));
  const canonical = becameInvalid || invalid ? [] : safeBindings;
  const result = {
    schema_version: RESULT_VERSION,
    authority: { kind: "local", authoritative: false },
    provenance: {
      kind: captureVerified ? "local_deterministic_capture" : "unadmitted_direct",
      capture_verified: captureVerified,
      filesystem_paths_authoritative: false,
      snapshot_completeness_authoritative: false,
      caller_values_authoritative: false,
      runtime_truth_authoritative: false
    },
    context: context && typeof context === "object" && !Array.isArray(context)
      ? Object.fromEntries(CONTEXT_FIELDS.map((field) => [
        field,
        typeof context[field] === "string" ? context[field] :
          field === "vocabulary_version" ? "invalid" : "0".repeat(64)
      ]))
      : Object.fromEntries(CONTEXT_FIELDS.map((field) => [
        field, field === "vocabulary_version" ? "invalid" : "0".repeat(64)
      ])),
    satisfaction: invalid || becameInvalid || relationInvalid ? "invalid" :
      indeterminate ? "indeterminate" : unsatisfied ? "unsatisfied" : "satisfied",
    binding_set_sha256: sha256(canonicalJsonBytes({
      context: context ?? null,
      bindings: canonical
    })),
    bindings: canonical,
    relation_results: invalid || becameInvalid ? [] : relationResults,
    diagnostics: diagnostics.sort(diagnosticsOrder)
  };
  assertSchema(
    "controlled-contract-exact-binding-result.v1.schema.json",
    result,
    "exact_binding_result_internal_invalid"
  );
  const frozen = deepFreeze(result);
  if (captureVerified) CAPTURED_RESULTS.add(frozen);
  return frozen;
}

function assertCapturedExactBindingResult(result) {
  if (!CAPTURED_RESULTS.has(result) || !Object.isFrozen(result)) {
    throw new ExactBindingError(
      "exact_binding_result_unrecognized",
      "aggregate proof requires the exact result returned by deterministic capture"
    );
  }
  return result;
}

function evaluateExactBindingsV1(input) {
  return coreEvaluate(input, false);
}

function evaluateCapturedExactBindingsV1(input, authority) {
  if (authority !== INTERNAL_CAPTURE_AUTHORITY) throw new ExactBindingError(
    "exact_binding_capture_authority_missing",
    "only the internal deterministic capture runner can assert verified capture"
  );
  return coreEvaluate(input, true);
}

function evaluateCaptureFailureExactBindingsV1(input, failure, authority) {
  if (authority !== INTERNAL_CAPTURE_AUTHORITY) throw new ExactBindingError(
    "exact_binding_capture_authority_missing",
    "only the internal deterministic capture runner can report capture failure"
  );
  const result = coreEvaluate({
    ...input,
    bindings: [],
    internalCaptureFailure: failure
  }, false);
  CAPTURED_RESULTS.add(result);
  return result;
}

export {
  assertCapturedExactBindingResult,
  INTERNAL_CAPTURE_AUTHORITY,
  assertCanonicalDeclarationFile,
  canonicalDigest,
  evaluateCaptureFailureExactBindingsV1,
  evaluateCapturedExactBindingsV1,
  evaluateExactBindingsV1,
  semanticDeclarationDiagnostics
};

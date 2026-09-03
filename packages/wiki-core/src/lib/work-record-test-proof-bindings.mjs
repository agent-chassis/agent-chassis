const PACKAGE_SPECIFIER = "@agent-chassis/controlled-contract";
const STABLE_V1 = "controlled-acceptance-contract.v1";
const CLOSED_NODE_TEST_TARGET_RE =
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.mjs$/u;
const EXECUTABLE_VALIDATION_FIELDS = Object.freeze([
  "operation", "target", "verification_ids"
]);
const NOTE_VALIDATION_FIELDS = Object.freeze(["note", "verification_ids"]);

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function diagnostic(code, field, details = {}) {
  return {
    code,
    field,
    ...details,
    recovery: {
      tool: "workspace_controlled_test_proof_query",
      arguments: details.verification_id
        ? { verification_ids: [details.verification_id] }
        : { verification_ids: [] }
    }
  };
}

function canonicalWorkRecordUnits(workRecord) {
  return [workRecord, ...(Array.isArray(workRecord?.slices) ? workRecord.slices : [])]
    .filter((unit) => unit && typeof unit === "object");
}

function isClosedRelativeTarget(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validationIssue(code, path, message, details = {}) {
  return Object.freeze({ code, path, message, ...details });
}

function sameFields(entry, allowed) {
  if (Object.getPrototypeOf(entry) !== Object.prototype) return false;
  const keys = Object.getOwnPropertyNames(entry).sort();
  return keys.length === allowed.length &&
    keys.every((key, index) => key === [...allowed].sort()[index]);
}

function validateVerificationIds({ value, path, issues }) {
  if (!Array.isArray(value)) {
    issues.push(validationIssue("validation_verification_ids_invalid", path,
      `${path} must be an array of nonblank strings`));
    return null;
  }
  const seen = new Set();
  const projected = [];
  value.forEach((identity, index) => {
    const identityPath = `${path}[${index}]`;
    if (typeof identity !== "string" || identity.trim().length === 0) {
      issues.push(validationIssue("validation_verification_id_invalid", identityPath,
        `${identityPath} must be a nonblank string`));
    } else if (seen.has(identity)) {
      issues.push(validationIssue("validation_verification_id_duplicate", identityPath,
        `${identityPath} duplicates verification identity '${identity}'`,
        { verification_id: identity }));
    } else {
      seen.add(identity);
      projected.push(identity);
    }
  });
  return projected.sort();
}

export function projectWorkRecordTestProofValidation({
  selectedUnit,
  path = "acceptance.validation"
}) {
  const validation = selectedUnit?.acceptance?.validation;
  const issues = [];
  const declarations = [];
  const notes = [];
  const validationEntries = [];
  const seenExecutableVerificationIds = new Set();
  if (selectedUnit?.sections && typeof selectedUnit.sections === "object" &&
      Object.hasOwn(selectedUnit.sections, "structured_validation")) {
    issues.push(validationIssue(
      "structured_validation_not_supported",
      "sections.structured_validation",
      "sections.structured_validation is not supported; declare validation in acceptance.validation"
    ));
  }
  if (!Array.isArray(validation)) {
    issues.push(validationIssue("validation_section_invalid", path,
      `${path} must be an array`));
  } else {
    validation.forEach((entry, index) => {
      const entryPath = `${path}[${index}]`;
      if (typeof entry === "string") {
        if (entry.trim().length === 0) issues.push(validationIssue(
          "validation_note_invalid", entryPath, `${entryPath} must be a nonblank note`
        ));
        else {
          notes.push(Object.freeze({ note: entry, verification_ids: Object.freeze([]) }));
          validationEntries.push(entry);
        }
        return;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        issues.push(validationIssue("validation_entry_invalid", entryPath,
          `${entryPath} must be a note string or current structured validation object`));
        return;
      }
      if (Object.hasOwn(entry, "operation")) {
        if (!sameFields(entry, EXECUTABLE_VALIDATION_FIELDS)) {
          issues.push(validationIssue("validation_executable_fields_invalid", entryPath,
            `${entryPath} must contain exactly operation, target, and verification_ids`));
          return;
        }
        if (entry.operation !== "node_test") issues.push(validationIssue(
          "validation_operation_invalid", `${entryPath}.operation`,
          `${entryPath}.operation must be node_test`
        ));
        if (typeof entry.target !== "string" || entry.target.startsWith("-") ||
            !CLOSED_NODE_TEST_TARGET_RE.test(entry.target) ||
            !isClosedRelativeTarget(entry.target)) issues.push(validationIssue(
          "validation_target_invalid", `${entryPath}.target`,
          `${entryPath}.target must be one canonical repository-relative .mjs test-module path`
        ));
        const verificationIds = validateVerificationIds({
          value: entry.verification_ids,
          path: `${entryPath}.verification_ids`,
          issues
        });
        if (verificationIds !== null) {
          for (const identity of verificationIds) {
            if (seenExecutableVerificationIds.has(identity)) issues.push(validationIssue(
              "validation_verification_binding_duplicate",
              `${entryPath}.verification_ids`,
              `${entryPath}.verification_ids duplicates executable verification binding '${identity}'`,
              { verification_id: identity }
            ));
            seenExecutableVerificationIds.add(identity);
          }
        }
        if (entry.operation === "node_test" && typeof entry.target === "string" &&
            CLOSED_NODE_TEST_TARGET_RE.test(entry.target) &&
            isClosedRelativeTarget(entry.target) && verificationIds !== null) {
          declarations.push(Object.freeze({
            operation: "node_test",
            target: entry.target,
            verification_ids: Object.freeze(verificationIds)
          }));
          validationEntries.push(Object.freeze({
            operation: "node_test",
            target: entry.target,
            verification_ids: Object.freeze(verificationIds)
          }));
        }
        return;
      }
      if (!sameFields(entry, NOTE_VALIDATION_FIELDS)) {
        issues.push(validationIssue("validation_note_fields_invalid", entryPath,
          `${entryPath} must contain exactly note and verification_ids`));
        return;
      }
      if (typeof entry.note !== "string" || entry.note.trim().length === 0) issues.push(
        validationIssue("validation_note_invalid", `${entryPath}.note`,
          `${entryPath}.note must be a nonblank string`)
      );
      const verificationIds = validateVerificationIds({
        value: entry.verification_ids,
        path: `${entryPath}.verification_ids`,
        issues
      });
      if (typeof entry.note === "string" && entry.note.trim().length > 0 &&
          verificationIds !== null) {
        const note = Object.freeze({
          note: entry.note,
          verification_ids: Object.freeze(verificationIds)
        });
        notes.push(note);
        validationEntries.push(note);
      }
    });
  }
  declarations.sort((left, right) =>
    `${left.operation}:${left.target}`.localeCompare(`${right.operation}:${right.target}`));
  const bindingSets = new Map();
  for (const entry of declarations) {
    const identities = bindingSets.get(entry.target) ?? new Set();
    for (const identity of entry.verification_ids) identities.add(identity);
    bindingSets.set(entry.target, identities);
  }
  const projected = [...bindingSets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([target, identities]) => [target, [...identities].sort()]);
  return deepFreeze({
    schema_version: "work-record-validation-declarations.v1",
    status: issues.length === 0 ? "valid" : "invalid",
    diagnostics: issues,
    validation_entries: validationEntries,
    executable_declarations: declarations,
    notes,
    targets: [...new Set(projected.map(([target]) => target))].sort(),
    validation_bindings: Object.fromEntries(projected)
  });
}

export function renderWorkRecordValidationEntry(entry) {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object" && entry.operation === "node_test") {
    return JSON.stringify({
      operation: entry.operation,
      target: entry.target,
      verification_ids: entry.verification_ids
    });
  }
  if (entry && typeof entry === "object" && typeof entry.note === "string") {
    return JSON.stringify({ note: entry.note, verification_ids: entry.verification_ids });
  }
  return "";
}

function resolveAuthorizedDeclaredTestTarget({
  workRecord,
  selectedUnit,
  reviewedTargetBinding = null,
  orchestrator = false,
  verificationId,
  controlledContractGeneration,
  sourceSnapshotDigest = null
}) {
  if (orchestrator === true && reviewedTargetBinding !== null) {
    return deepFreeze({
      schema_version: "wiki-core-declared-test-target-resolution.v1",
      status: "refused",
      verification_id: verificationId,
      diagnostics: [diagnostic("test_proof_orchestrator_review_binding_forbidden",
        "/reviewed_target_binding", { verification_id: verificationId })]
    });
  }
  if (orchestrator === true) {
    const projectedUnits = canonicalWorkRecordUnits(workRecord).map((unit) => ({
      unit,
      unitAddress: unit?.id?.startsWith("SLICE-")
        ? `${workRecord?.id}#${unit.id}` : workRecord?.id,
      projection: projectWorkRecordTestProofValidation({ selectedUnit: unit })
    }));
    const diagnostics = [];
    for (const { unitAddress, projection } of projectedUnits) {
      if (projection.status !== "valid") diagnostics.push(...projection.diagnostics.map((entry) =>
        diagnostic(entry.code, `${unitAddress}/${entry.path}`, { verification_id: verificationId })
      ));
    }
    const resolutions = projectedUnits.flatMap(({ unitAddress, projection }) =>
      projection.executable_declarations.map((entry, index) => ({ entry, index, unitAddress })));
    const matches = [];
    let bindingCount = 0;
    for (const { entry, index, unitAddress } of resolutions) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const ids = Array.isArray(entry.verification_ids) ? entry.verification_ids : [];
      const occurrences = ids.filter((id) => id === verificationId).length;
      if (occurrences === 0) continue;
      bindingCount += occurrences;
      const field = `${unitAddress}/acceptance/validation/${index}`;
      matches.push({ target: entry.target, unitAddress, field });
    }
    if (bindingCount > 1) diagnostics.push(diagnostic(
      "test_proof_declared_target_duplicate", "/acceptance/validation",
      { verification_id: verificationId, binding_count: bindingCount }
    ));
    if (diagnostics.length > 0) return deepFreeze({
      schema_version: "wiki-core-declared-test-target-resolution.v1",
      status: "refused",
      verification_id: verificationId,
      diagnostics
    });
    if (matches.length === 0) return deepFreeze({
      schema_version: "wiki-core-declared-test-target-resolution.v1",
      status: "unavailable",
      reason_code: "verify_proof.declared_target_missing.v1",
      verification_id: verificationId,
      unit: workRecord?.id
    });
    const [{ target, unitAddress }] = matches;
    return deepFreeze({
      schema_version: "wiki-core-declared-test-target-resolution.v1",
      status: "resolved",
      verification_id: verificationId,
      unit: unitAddress,
      operation: "node_test",
      target,
      target_id: `declared-target:${unitAddress}:${verificationId}:${target}`,
      controlled_contract_generation: controlledContractGeneration,
      source_snapshot_digest: sourceSnapshotDigest
    });
  }
  const selectedUnitAddress = selectedUnit?.id?.startsWith("SLICE-")
    ? `${workRecord?.id}#${selectedUnit.id}` : workRecord?.id;
  let targetUnit = selectedUnit;
  let unitAddress = selectedUnitAddress;
  if (reviewedTargetBinding !== null) {
    const reviewedUnit = reviewedTargetBinding?.reviewed_unit;
    if (reviewedTargetBinding?.schema_version !==
        "launcher-frozen-reviewed-test-target-binding.v1" ||
        reviewedTargetBinding?.reviewer_unit !== selectedUnitAddress) {
      return deepFreeze({
        schema_version: "wiki-core-declared-test-target-resolution.v1",
        status: "refused",
        verification_id: verificationId,
        diagnostics: [diagnostic("test_proof_reviewed_target_binding_stale",
          "/reviewed_target_binding", { verification_id: verificationId })]
      });
    }
    if (reviewedUnit === null || reviewedUnit === undefined || reviewedUnit === "") {
      return deepFreeze({
        schema_version: "wiki-core-declared-test-target-resolution.v1",
        status: "unavailable",
        reason_code: "verify_proof.reviewed_target_binding_missing.v1",
        verification_id: verificationId,
        unit: selectedUnitAddress
      });
    }
    const prefix = `${workRecord?.id}#`;
    if (typeof reviewedUnit !== "string" || !reviewedUnit.startsWith(prefix) ||
        reviewedUnit.slice(prefix.length).includes("#")) {
      return deepFreeze({
        schema_version: "wiki-core-declared-test-target-resolution.v1",
        status: "refused",
        verification_id: verificationId,
        diagnostics: [diagnostic("test_proof_reviewed_target_binding_cross_bound",
          "/reviewed_target_binding/reviewed_unit", { verification_id: verificationId })]
      });
    }
    if (selectedUnit?.admission_review_target_unit !== reviewedUnit) {
      return deepFreeze({
        schema_version: "wiki-core-declared-test-target-resolution.v1",
        status: "refused",
        verification_id: verificationId,
        diagnostics: [diagnostic("test_proof_reviewed_target_binding_stale",
          "/reviewed_target_binding/reviewed_unit", { verification_id: verificationId })]
      });
    }
    const sliceId = reviewedUnit.slice(prefix.length);
    const matches = (workRecord?.slices ?? []).filter(({ id }) => id === sliceId);
    if (matches.length !== 1) {
      return deepFreeze({
        schema_version: "wiki-core-declared-test-target-resolution.v1",
        status: "refused",
        verification_id: verificationId,
        diagnostics: [diagnostic(matches.length === 0
          ? "test_proof_reviewed_target_binding_stale"
          : "test_proof_reviewed_target_binding_ambiguous",
        "/reviewed_target_binding/reviewed_unit", { verification_id: verificationId })]
      });
    }
    [targetUnit] = matches;
    unitAddress = reviewedUnit;
  }
  const projection = projectWorkRecordTestProofValidation({ selectedUnit: targetUnit });
  if (projection.status !== "valid") return deepFreeze({
    schema_version: "wiki-core-declared-test-target-resolution.v1",
    status: "refused",
    verification_id: verificationId,
    diagnostics: projection.diagnostics.map((entry) => diagnostic(
      entry.code, entry.path, { verification_id: verificationId }
    ))
  });
  const entries = projection.executable_declarations;
  const diagnostics = [];
  const matches = [];
  let bindingCount = 0;
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const ids = Array.isArray(entry.verification_ids) ? entry.verification_ids : [];
    const occurrences = ids.filter((id) => id === verificationId).length;
    if (occurrences === 0) return;
    bindingCount += occurrences;
    const field = `/acceptance/validation/${index}`;
    matches.push({ target: entry.target, index });
  });
  if (bindingCount > 1) diagnostics.push(diagnostic(
    "test_proof_declared_target_duplicate", "/acceptance/validation",
    { verification_id: verificationId, binding_count: bindingCount }
  ));
  if (diagnostics.length > 0) return deepFreeze({
    schema_version: "wiki-core-declared-test-target-resolution.v1",
    status: "refused",
    verification_id: verificationId,
    diagnostics
  });
  if (matches.length === 0) return deepFreeze({
    schema_version: "wiki-core-declared-test-target-resolution.v1",
    status: "unavailable",
    reason_code: "verify_proof.declared_target_missing.v1",
    verification_id: verificationId,
    unit: unitAddress
  });
  const [{ target }] = matches;
  return deepFreeze({
    schema_version: "wiki-core-declared-test-target-resolution.v1",
    status: "resolved",
    verification_id: verificationId,
    unit: unitAddress,
    operation: "node_test",
    target,
    target_id: `declared-target:${unitAddress}:${verificationId}:${target}`,
    controlled_contract_generation: controlledContractGeneration,
    source_snapshot_digest: sourceSnapshotDigest
  });
}

function deriveWorkRecordTestProofBindingFacts({selectedUnit}) {
  const projection = projectWorkRecordTestProofValidation({ selectedUnit });
  const diagnostics = projection.diagnostics.map((entry) =>
    diagnostic(entry.code, entry.path));
  const bindings = projection.executable_declarations.flatMap((entry) =>
    entry.verification_ids.map((verificationId) => ({
      verification_id: verificationId,
      operation: entry.operation,
      target: entry.target
    })));
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map((entry) => Object.freeze(entry))),
    validation_bindings: Object.freeze(bindings.map((binding) =>
      Object.freeze(binding)).sort((left, right) =>
      left.verification_id.localeCompare(right.verification_id)))
  });
}

async function validateWorkRecordTestProofBindings({
  workRecord,
  selectedUnit,
  controlledContract,
  packageApi = null
}) {
  if (controlledContract?.schema_version !== STABLE_V1) return {
    status: "refused",
    diagnostics: [diagnostic(
      "test_proof_contract_version_unsupported", "/schema_version"
    )],
    validation_bindings: [],
    semantic_judgment: "not_performed_coordinator_owned"
  };
  const api = packageApi ?? await import(PACKAGE_SPECIFIER);
  const validation = api.validateStableTestProofContract(controlledContract);
  if (!validation.valid) return {
    status: "refused",
    diagnostics: [diagnostic(
      (validation.diagnostics?.diagnostics ?? []).some(({ code }) =>
        String(code).includes("provider"))
        ? "test_proof_provider_binding_invalid" : "test_proof_contract_invalid",
      "/test_proofs", {
      package_diagnostics: validation.diagnostics
    })],
    validation_bindings: [],
    semantic_judgment: "not_performed_coordinator_owned"
  };
  const projection = projectWorkRecordTestProofValidation({ selectedUnit });
  const diagnostics = projection.diagnostics.map((entry) =>
    diagnostic(entry.code, entry.path));
  const bindings = projection.executable_declarations.flatMap((entry) =>
    entry.verification_ids.map((verificationId) => ({
      verification_id: verificationId,
      operation: entry.operation,
      target: entry.target,
      field: "/acceptance/validation"
    })));
  const claims = new Map(controlledContract.claims.map((claim) => [claim.claim_id, claim]));
  const required = controlledContract.claims.filter(({kind, verification_method: method}) =>
    kind === "verification" && method === "test_execution"
  ).map(({claim_id: id}) => id).sort();
  const bound = new Set(bindings.map(({verification_id: id}) => id));
  for (const verificationId of required) if (!bound.has(verificationId)) diagnostics.push(
    diagnostic("test_proof_validation_binding_missing", "/acceptance/validation", {
      verification_id: verificationId
    })
  );
  for (const binding of bindings) {
    const crossWk = /^WK-[0-9]{4}#/.exec(binding.verification_id);
    if (crossWk && !binding.verification_id.startsWith(`${workRecord.id}#`)) {
      diagnostics.push(diagnostic(
        "test_proof_verification_cross_wk", binding.field,
        {verification_id: binding.verification_id}
      ));
      continue;
    }
    const claim = claims.get(binding.verification_id);
    if (!claim) diagnostics.push(diagnostic(
      "test_proof_verification_id_stale", binding.field,
      {verification_id: binding.verification_id}
    ));
    else if (!(claim.kind === "verification" && claim.verification_method === "test_execution")) {
      diagnostics.push(diagnostic(
        "test_proof_verification_not_test_execution", binding.field,
        {verification_id: binding.verification_id}
      ));
    }
  }
  if (diagnostics.length === 0) {
    try {
      const selected = api.queryStableTestProofBindings({
        contract: controlledContract,
        verificationIds: [...bound]
      });
      if (selected.matched_count !== bound.size) diagnostics.push(diagnostic(
        "test_proof_binding_incomplete", "/test_proofs"
      ));
      for (const binding of selected.bindings) {
        api.resolveStableTestProofProviderBindings(binding);
      }
    } catch (error) {
      diagnostics.push(diagnostic(
        "test_proof_binding_invalid", "/test_proofs",
        {package_code: error?.code ?? null, package_details: error?.details ?? {}}
      ));
    }
  }
  diagnostics.sort((left, right) =>
    `${left.field}:${left.code}`.localeCompare(`${right.field}:${right.code}`));
  return {
    status: diagnostics.length === 0 ? "admitted" : "refused",
    wk_id: workRecord.id,
    diagnostics,
    validation_bindings: bindings.map(({field: ignored, ...binding}) => binding)
      .sort((left, right) => left.verification_id.localeCompare(right.verification_id)),
    semantic_judgment: "not_performed_coordinator_owned"
  };
}

export {
  deriveWorkRecordTestProofBindingFacts,
  resolveAuthorizedDeclaredTestTarget,
  validateWorkRecordTestProofBindings
};

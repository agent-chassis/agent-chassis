import { CLOSED_NODE_TEST_TARGET_STATEMENT, isClosedNodeTestTarget, resolveNativeTestSelector,
  TEST_RUNTIME_ENVIRONMENT_ID_RE } from
  "@agent-chassis/controlled-contract/test-proof";
import { parseRepositoryScopePath, parseRepositoryScopeFileSelector } from "./work-record-repository-path.mjs";

export { CLOSED_NODE_TEST_TARGET_STATEMENT, isClosedNodeTestTarget };

const PACKAGE_SPECIFIER = "@agent-chassis/controlled-contract";
const STABLE_V1 = "controlled-acceptance-contract.v1";
const EXECUTABLE_VALIDATION_FIELDS = Object.freeze([
  "operation", "target", "verification_ids"
]);
const NOTE_VALIDATION_FIELDS = Object.freeze(["note", "verification_ids"]);

const COMMAND_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u;
const COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const textSchema = { type: "string", minLength: 1 };
const closedSchema = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });

export const REPOSITORY_TEST_DECLARATION_SCHEMA = deepFreeze(closedSchema({
  operation: { type: "string", const: "repository_test" }, id: textSchema, purpose: textSchema,
  default_selection: textSchema,
  selections: { type: "array", minItems: 1, items: closedSchema({
    id: textSchema,
    harness: closedSchema({ cwd: textSchema, argv: { type: "array", minItems: 1,
      items: { type: "string" } } }, ["cwd", "argv"]),
    definition_paths: { type: "array", minItems: 1, items: textSchema },
    environment: textSchema,
    additional_baseline_commits: { type: "array", items: textSchema }
  }, ["id", "harness", "definition_paths"]) }
}, ["operation", "id", "purpose", "selections"]));
const repositoryDirectory = value => value === "." ||
  (parseRepositoryScopePath(value).ok && !value.endsWith("/"));

function validateRepositoryTest(entry, entryPath, issues) {
  const start = issues.length;
  const check = (ok, suffix, cause) => {
    if (!ok) issues.push(validationIssue(`repository_test_${cause}`, `${entryPath}${suffix}`,
      `${entryPath}${suffix}: ${cause.replaceAll("_", " ")}`));
  };
  const fields = (value, required, optional = []) => value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.getOwnPropertyNames(value).every(key => [...required, ...optional].includes(key));
  check(fields(entry, ["operation", "id", "purpose", "selections"], ["default_selection"]), "", "fields_invalid");
  check(typeof entry.id === "string" && COMMAND_ID.test(entry.id), ".id", "id_invalid");
  check(typeof entry.purpose === "string" && entry.purpose.trim().length > 0, ".purpose", "purpose_invalid");
  check(Array.isArray(entry.selections) && entry.selections.length > 0, ".selections", "selections_invalid");
  const seen = new Set();
  for (const [index, selection] of (Array.isArray(entry.selections) ? entry.selections : []).entries()) {
    const at = `.selections[${index}]`;
    if (!fields(selection, ["id", "harness", "definition_paths"], ["environment", "additional_baseline_commits"])) {
      check(false, at, "selection_fields_invalid"); continue;
    }
    check(typeof selection.id === "string" && COMMAND_ID.test(selection.id), `${at}.id`, "selection_id_invalid");
    check(!seen.has(selection.id), `${at}.id`, "selection_id_duplicate"); seen.add(selection.id);
    check(fields(selection.harness, ["cwd", "argv"]), `${at}.harness`, "harness_fields_invalid");
    check(repositoryDirectory(selection.harness?.cwd), `${at}.harness.cwd`, "cwd_invalid");
    const argv = selection.harness?.argv;
    check(Array.isArray(argv) && argv.length > 0 && typeof argv[0] === "string" && argv[0].length > 0 &&
      argv.every(value => typeof value === "string" && !value.includes("\0")), `${at}.harness.argv`, "argv_invalid");
    const paths = selection.definition_paths;
    check(Array.isArray(paths) && paths.length > 0 && paths.every(value => parseRepositoryScopeFileSelector(value).ok) &&
      new Set(paths).size === paths.length, `${at}.definition_paths`, "definition_paths_invalid");
    if (Object.hasOwn(selection, "environment")) check(typeof selection.environment === "string" &&
      TEST_RUNTIME_ENVIRONMENT_ID_RE.test(selection.environment), `${at}.environment`, "environment_invalid");
    if (Object.hasOwn(selection, "additional_baseline_commits")) {
      const commits = selection.additional_baseline_commits;
      check(Array.isArray(commits) && commits.every(value => typeof value === "string" && COMMIT_ID.test(value)) &&
        new Set(commits).size === commits.length, `${at}.additional_baseline_commits`, "baseline_commits_invalid");
    }
  }
  if (Object.hasOwn(entry, "default_selection")) check(typeof entry.default_selection === "string" &&
    seen.has(entry.default_selection), ".default_selection", "default_selection_invalid");
  return issues.length === start;
}

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
      capability: "saved proof declaration correction",
      available_route: null,
      reason: "this validation boundary does not own the unit identity required for a callable semantic correction"
    }
  };
}

function canonicalWorkRecordUnits(workRecord) {
  return [workRecord, ...(Array.isArray(workRecord?.slices) ? workRecord.slices : [])]
    .filter((unit) => unit && typeof unit === "object");
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
  const repositoryTests = [];
  const commandIds = new Set();
  const notes = [];
  const validationEntries = [];

  const entryKinds = [];
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
      entryKinds[index] = "invalid";
      if (typeof entry === "string") {
        if (entry.trim().length === 0) issues.push(validationIssue(
          "validation_note_invalid", entryPath, `${entryPath} must be a nonblank note`
        ));
        else {
          notes.push(Object.freeze({ note: entry, verification_ids: Object.freeze([]) }));
          validationEntries.push(entry);
          entryKinds[index] = "note";
        }
        return;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        issues.push(validationIssue("validation_entry_invalid", entryPath,
          `${entryPath} must be a note string or current structured validation object`));
        return;
      }
      if (Object.hasOwn(entry, "operation")) {
        if (entry.operation === "repository_test") {
          const valid = validateRepositoryTest(entry, entryPath, issues);
          if (commandIds.has(entry.id)) issues.push(validationIssue("repository_test_id_duplicate", `${entryPath}.id`,
            `${entryPath}.id duplicates repository command '${entry.id}'`));
          commandIds.add(entry.id);
          if (valid) {
            const command = deepFreeze(structuredClone(entry));
            repositoryTests.push(command); validationEntries.push(command); entryKinds[index] = "repository_test";
          }
          return;
        }
        if (!sameFields(entry, EXECUTABLE_VALIDATION_FIELDS)) {
          issues.push(validationIssue("validation_executable_fields_invalid", entryPath,
            `${entryPath} must contain exactly operation, target, and verification_ids`));
          return;
        }
        if (entry.operation !== "node_test") issues.push(validationIssue(
          "validation_operation_invalid", `${entryPath}.operation`,
          `${entryPath}.operation must be node_test`
        ));
        if (!isClosedNodeTestTarget(entry.target)) issues.push(validationIssue(
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
        if (entry.operation === "node_test" && isClosedNodeTestTarget(entry.target) &&
            verificationIds !== null) {
          entryKinds[index] = "executable";
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
        entryKinds[index] = "note";
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
    entry_kinds: entryKinds,
    executable_declarations: declarations,
    repository_tests: repositoryTests,
    notes,
    targets: [...new Set(projected.map(([target]) => target))].sort(),
    validation_bindings: Object.fromEntries(projected)
  });
}

function workRecordUnitAddress(workRecord, unit) {
  return unit?.id === workRecord?.id ? workRecord?.id : `${workRecord?.id}#${unit?.id}`;
}

export function projectCaseOwnedTestProofValidation({ workRecord, selectedUnit, caseTargets }) {
  const selected = projectWorkRecordTestProofValidation({ selectedUnit });
  const selectedAddress = workRecordUnitAddress(workRecord, selectedUnit);
  const owned = new Map(caseTargets.filter(({ owner_unit: owner }) => typeof owner === "string")
    .map(({ verification_id: id, owner_unit: owner }) => [id, owner]));
  if (owned.size === 0) return selected;
  const units = new Map(canonicalWorkRecordUnits(workRecord).map((unit) =>
    [workRecordUnitAddress(workRecord, unit), unit]));
  const projections = new Map([[selectedAddress, selected]]);
  const project = (address) => {
    if (!projections.has(address)) projections.set(address,
      projectWorkRecordTestProofValidation({ selectedUnit: units.get(address) }));
    return projections.get(address);
  };
  const declared = (address, id) => project(address).executable_declarations
    .filter((entry) => entry.verification_ids.includes(id))
    .map((entry) => ({ operation: entry.operation, target: entry.target,
      verification_ids: [id], unit: address }));
  const diagnostics = [...selected.diagnostics];
  const invalidOwners = new Set();
  const declarations = selected.executable_declarations.flatMap((entry) => {
    const ids = entry.verification_ids.filter((id) => !owned.has(id));
    return ids.length === 0 ? [] : [{ ...entry, verification_ids: ids, unit: selectedAddress }];
  });
  const resolutions = [];
  for (const [id, owner] of [...owned].sort(([left], [right]) => left.localeCompare(right))) {
    if (!units.has(owner)) {
      diagnostics.push(validationIssue("validation_case_owner_unit_missing", "cases/target/owner_unit",
        `the shared case owner '${owner}' of verification '${id}' is not a unit of ${workRecord?.id}`,
        { verification_id: id, owner_unit: owner }));
      resolutions.push({ verification_id: id, owner_unit: owner, status: "owner_missing", declaring_units: [] });
      continue;
    }
    if (owner !== selectedAddress && project(owner).status !== "valid" && !invalidOwners.has(owner)) {
      invalidOwners.add(owner);
      diagnostics.push(...project(owner).diagnostics.map((entry) =>
        ({ ...entry, path: `${owner}/${entry.path}`, owner_unit: owner })));
    }
    const ownerDeclarations = declared(owner, id);
    const foreign = [...units.keys()].filter((address) => address !== owner)
      .flatMap((address) => declared(address, id));
    const duplicates = ownerDeclarations.length === 0 ? [] : foreign;
    declarations.push(...ownerDeclarations, ...duplicates);
    const count = ownerDeclarations.length + duplicates.length;
    resolutions.push({ verification_id: id, owner_unit: owner,
      status: count === 0 ? "declaration_missing" : count === 1 ? "resolved" : "ambiguous",
      declaring_units: [...new Set([...ownerDeclarations, ...foreign].map(({ unit }) => unit))].sort() });
  }
  declarations.sort((left, right) =>
    `${left.target}:${left.unit}:${left.verification_ids.join()}`.localeCompare(
      `${right.target}:${right.unit}:${right.verification_ids.join()}`));
  return deepFreeze({
    ...structuredClone(selected),
    schema_version: "work-record-case-owned-validation-declarations.v1",
    status: diagnostics.length === 0 ? "valid" : "invalid",
    diagnostics,
    executable_declarations: declarations,
    case_owner_resolutions: resolutions
  });
}

export function renderWorkRecordValidationEntry(entry) {
  if (typeof entry === "string") return entry.trim();
  if (entry?.operation === "repository_test") return JSON.stringify(entry);
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
  caseOwnedDeclarations = null,
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

  const local = projectWorkRecordTestProofValidation({ selectedUnit: targetUnit });
  const assigned = unitAddress !== workRecord?.id && local.status === "valid" &&
    !local.executable_declarations.some((entry) => entry.verification_ids.includes(verificationId)) &&
    caseOwnedDeclarations?.case_owner_resolutions?.some((entry) =>
      entry.verification_id === verificationId &&
      (entry.owner_unit === workRecord?.id || entry.status === "owner_missing")) === true;
  const projection = assigned ? caseOwnedDeclarations : local;
  const issues = projection.diagnostics.filter((entry) => !assigned ||
    (entry.verification_id ?? verificationId) === verificationId);
  if (issues.length > 0) return deepFreeze({
    schema_version: "wiki-core-declared-test-target-resolution.v1",
    status: "refused",
    verification_id: verificationId,
    diagnostics: issues.map((entry) => diagnostic(
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

function resolveNativeCaseDeclaredTestTarget({
  verificationId,
  selector,
  unit,
  controlledContractGeneration,
  sourceSnapshotDigest = null
}) {
  const native = resolveNativeTestSelector(selector);
  if (!native.valid) return deepFreeze({
    schema_version: "wiki-core-declared-test-target-resolution.v1",
    status: "refused",
    verification_id: verificationId,
    diagnostics: [diagnostic("test_proof_native_case_target_invalid", "/cases/target", {
      verification_id: verificationId, selector_pointer: native.pointer })]
  });
  return deepFreeze({
    schema_version: "wiki-core-declared-test-target-resolution.v1",
    status: "resolved",
    verification_id: verificationId,
    unit,
    operation: "native_test_proof",
    target_owner: "authored_case_target",
    provider: { provider_id: native.provider_id, provider_version: native.provider_version },
    target: native.path,
    target_id: `native-case-target:${unit}:${verificationId}:${native.provider_id}@${native.provider_version}:${native.path}`,
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
  packageApi = null,
  nativeCaseVerificationIds = []
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

  const nativeBound = new Set(nativeCaseVerificationIds);
  for (const verificationId of required) if (!bound.has(verificationId) &&
      !nativeBound.has(verificationId)) diagnostics.push(
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
  resolveNativeCaseDeclaredTestTarget,
  validateWorkRecordTestProofBindings
};

export function removeWorkRecordTestProofTarget(unit, verificationId) {
  const prospective = structuredClone(unit.acceptance.validation);
  for (let index = prospective.length - 1; index >= 0; index--) {
    const entry = prospective[index];
    if (entry?.operation !== 'node_test' || !entry.verification_ids?.includes(verificationId)) continue;
    entry.verification_ids = entry.verification_ids.filter(id => id !== verificationId);
    if (entry.verification_ids.length === 0) prospective.splice(index, 1);
  }
  unit.acceptance.validation = prospective;
}

export function amendWorkRecordTestProofTarget(unit, verificationId, target) {
  if (unit.acceptance.validation.some(entry => entry?.operation === 'node_test' && entry.target === target &&
      entry.verification_ids?.includes(verificationId))) return;
  const prospective = structuredClone(unit.acceptance.validation);
  for (let index = prospective.length - 1; index >= 0; index--) {
    const entry = prospective[index];
    if (entry?.operation !== 'node_test' || !entry.verification_ids?.includes(verificationId)) continue;
    entry.verification_ids = entry.verification_ids.filter(id => id !== verificationId);
    if (entry.verification_ids.length === 0) prospective.splice(index, 1);
  }
  const shared = prospective.find(entry => entry?.operation === 'node_test' && entry.target === target);
  if (shared) shared.verification_ids = [...shared.verification_ids, verificationId].sort();
  else prospective.push({ operation: 'node_test', target, verification_ids: [verificationId] });
  const validation = projectWorkRecordTestProofValidation({ selectedUnit: { ...unit,
    acceptance: { ...unit.acceptance, validation: prospective } } });
  if (validation.status !== 'valid') {
    const error = new Error('Prospective test target violates the work-record target contract');
    error.code = 'obligation_coverage_case_target_invalid'; error.details = { changed: false, validation }; throw error;
  }
  unit.acceptance.validation = prospective;
}

export function rebindWorkRecordTestProofVerificationIds(record, mapping) {
  const units = canonicalWorkRecordUnits(record);
  const address = unit => unit === record ? record.id : `${record.id}#${unit.id}`;
  const prospective = units.map(unit => {
    const validation = unit.acceptance?.validation;
    if (!Array.isArray(validation) || !validation.some(entry => entry?.operation === 'node_test' &&
        entry.verification_ids?.some(id => mapping.has(id)))) return null;
    return validation.map(entry => entry?.operation === 'node_test' && Array.isArray(entry.verification_ids)
      ? { ...entry, verification_ids: entry.verification_ids.map(id => mapping.get(id) ?? id) } : entry);
  });
  const fail = (code, message, details) => {
    const error = new Error(message);
    error.code = code; error.details = { changed: false, ...details }; throw error;
  };
  units.forEach((unit, index) => {
    if (prospective[index] === null) return;
    const validation = projectWorkRecordTestProofValidation({ selectedUnit: { ...unit,
      acceptance: { ...unit.acceptance, validation: prospective[index] } } });
    if (validation.status !== 'valid') fail('obligation_coverage_case_target_invalid',
      'Rebinding verification identities violates the work-record target contract',
      { unit: address(unit), validation });
  });
  const replacements = new Set(mapping.values());
  const declaringUnits = new Map();
  units.forEach((unit, index) => {
    for (const entry of prospective[index] ?? unit.acceptance?.validation ?? []) {
      if (entry?.operation !== 'node_test') continue;
      for (const id of entry.verification_ids ?? []) if (replacements.has(id)) {
        declaringUnits.set(id, [...new Set([...(declaringUnits.get(id) ?? []), address(unit)])]);
      }
    }
  });
  for (const [verificationId, owners] of declaringUnits) if (owners.length > 1) fail(
    'obligation_coverage_case_selector_cross_unit',
    'A rebound verification would be declared by more than one unit; change the target through its owner',
    { verification_id: verificationId, owner_units: owners.sort() });
  units.forEach((unit, index) => {
    if (prospective[index] !== null) unit.acceptance.validation = prospective[index];
  });
  return units.filter((_unit, index) => prospective[index] !== null).map(address);
}

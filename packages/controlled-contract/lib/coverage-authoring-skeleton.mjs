import { ACCEPTANCE_COVERAGE_STATES }
  from "./acceptance-coverage.mjs";

const MAX_INLINE_BYTES = 16_384;
const AXES = Object.freeze([
  "authored_contract_coverage", "structural_verification",
  "selected_pack_guarantee_coverage", "implementation_ownership",
  "verification_ownership", "scope_feasibility"
]);
const TERMS = Object.freeze([
  "common-unit-address-server-string",
  "common-selected-unit-server-nullable-string",
  "common-focus-server-nullable-slug",
  "common-selected-unit-digest-server-sha256",
  "common-criterion-identity-population-server",
  "common-contract-content-digest-server-sha256",
  "common-contract-node-population-server",
  "common-proof-plan-content-digest-server-nullable-sha256",
  "common-selected-pack-population-server",
  "common-carrier-status-server-enum",
  "common-currentness-changed-bindings-server",
  "common-mutation-operation-server-tool-identity",
  "common-mutation-stable-fixed-arguments-server-object",
  "common-mutation-cas-state-receipt-fed-sha256",
  "common-authored-unresolved-slot-population",
  "common-projection-total-server-integer-39",
  "common-projection-returned-server-integer",
  "common-projection-omitted-server-integer",
  "common-projection-inline-entry-population-server",
  "common-projection-complete-content-reference-existing-transport",
  "common-metric-call-count-integer",
  "common-metric-request-utf8-bytes-integer",
  "common-metric-result-utf8-bytes-integer",
  "common-metric-unresolved-slot-count-integer",
  "common-metric-retry-count-integer",
  "common-metric-source-inspection-escape-count-integer",
  "common-metric-final-carrier-equivalence-boolean",
  "obligation-row-obligation-id-authored-string",
  "obligation-row-statement-authored-trimmed-single-line-string",
  "obligation-row-criterion-selector-server-current-criterion",
  "obligation-row-contract-node-ids-authored-current-reference-list",
  "obligation-row-mechanism-authored-package-enum",
  "obligation-row-gap-authored-typed-alternative",
  "obligation-row-pack-component-authored-admitted-alternative",
  "obligation-mutation-expected-authoring-identity-server-string",
  "obligation-mutation-source-identity-server-object",
  "acceptance-row-criterion-identity-server-current-criterion",
  "acceptance-row-node-ids-authored-current-reference-list",
  "acceptance-row-axes-authored-complete-six-axis-state-map"
]);
const AUTHORED = Object.freeze({
  obligation: Object.freeze({
    28: "obligation_id", 29: "statement",
    31: "controlled_contract_node_ids", 32: "mechanism",
    33: "gap", 34: "pack_component"
  }),
  acceptance: Object.freeze({ 38: "node_ids", 39: "axes" })
});
const SERVER_VALUE_FIELDS = Object.freeze({
  1: "unitAddress", 2: "selectedUnit", 3: "focus",
  4: "selectedUnitDigest", 5: "criterionIdentities",
  6: "contractContentDigest", 7: "contractNodes",
  8: "proofPlanContentDigest", 9: "selectedPacks",
  10: "carrierStatus", 11: "changedBindings"
});

class CoverageAuthoringSkeletonError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CoverageAuthoringSkeletonError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(message, details = {}) {
  throw new CoverageAuthoringSkeletonError(
    "coverage_authoring_skeleton_input_invalid", message, details
  );
}

function assertPlain(value, name, seen = new WeakSet()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") fail(`${name} must contain only JSON plain data`);
  if (seen.has(value)) fail(`${name} must not contain cycles`);
  seen.add(value);
  if (!Array.isArray(value) && ![Object.prototype, null].includes(
    Object.getPrototypeOf(value))) fail(`${name} must contain only plain objects`);
  if (Array.isArray(value)) for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(
      `${name}[${index}] must not be a sparse array hole`, { name, index }
    );
  }
  for (const [key, child] of Object.entries(value)) assertPlain(child,
    `${name}.${key}`, seen);
  seen.delete(value);
}

function closedObject(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be a plain object`);
  }
  for (const key of Object.keys(value)) if (!keys.includes(key)) {
    fail(`${name}.${key} is not supported`, { name, key });
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} must be a non-empty string`, { name });
  }
}

function digest(value, name, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(`${name} must be ${nullable ? "null or " : ""}a canonical sha256 digest`);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function bytes(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

function pathExists(value, path) {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

function contentDigestPaths(value, prefix = "") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [key === "expected_content_digest" || key === "content_digest" ? path : [],
      contentDigestPaths(child, path)].flat();
  });
}

function normalize(input) {
  assertPlain(input, "input");
  closedObject(input, ["surface", "server", "inlineByteLimit"], "input");
  if (!["obligation", "acceptance"].includes(input.surface)) {
    fail("input.surface must be obligation or acceptance");
  }
  const serverKeys = [
    ...Object.values(SERVER_VALUE_FIELDS), "mutation", "obligation",
    "authoredDecisions"
  ];
  closedObject(input.server, serverKeys, "input.server");
  const server = structuredClone(input.server);
  requiredString(server.unitAddress, "input.server.unitAddress");
  if (server.selectedUnit !== null) requiredString(server.selectedUnit,
    "input.server.selectedUnit");
  if (server.focus !== null) {
    requiredString(server.focus, "input.server.focus");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(server.focus)) {
      fail("input.server.focus must be a lowercase slug or null");
    }
  }
  digest(server.selectedUnitDigest, "input.server.selectedUnitDigest");
  digest(server.contractContentDigest, "input.server.contractContentDigest");
  digest(server.proofPlanContentDigest, "input.server.proofPlanContentDigest", true);
  for (const name of ["criterionIdentities", "contractNodes", "selectedPacks",
    "changedBindings"]) if (!Array.isArray(server[name])) {
    fail(`input.server.${name} must be an array`);
  }
  requiredString(server.carrierStatus, "input.server.carrierStatus");
  closedObject(server.mutation,
    ["operation", "stableArguments", "receiptFedDigestFields"],
    "input.server.mutation");
  requiredString(server.mutation.operation, "input.server.mutation.operation");
  closedObject(server.mutation.stableArguments, Object.keys(
    server.mutation.stableArguments ?? {}), "input.server.mutation.stableArguments");
  if (!Array.isArray(server.mutation.receiptFedDigestFields) ||
      server.mutation.receiptFedDigestFields.some((field) =>
        typeof field !== "string" || field.length === 0)) {
    fail("input.server.mutation.receiptFedDigestFields must be a string array");
  }
  if (new Set(server.mutation.receiptFedDigestFields).size !==
      server.mutation.receiptFedDigestFields.length) {
    fail("input.server.mutation.receiptFedDigestFields must be unique");
  }
  for (const field of server.mutation.receiptFedDigestFields) {
    if (!field.includes("digest")) fail(
      "receipt-fed mutation fields must identify digest state", { field });
    if (pathExists(server.mutation.stableArguments, field)) fail(
      "receipt-fed digest state must not appear in stable mutation arguments", { field }
    );
  }
  if (server.mutation.receiptFedDigestFields.length > 0 &&
      contentDigestPaths(server.mutation.stableArguments).length > 0) {
    fail("current-carrier content digests must not appear in stable mutation arguments");
  }
  if (server.mutation.receiptFedDigestFields.length > 0 &&
      !server.mutation.receiptFedDigestFields.includes("expected_content_digest")) {
    fail("current-carrier mutation state must include expected_content_digest");
  }
  if (input.surface === "obligation") {
    closedObject(server.obligation, ["mechanisms", "gapAlternatives",
      "packComponents", "expectedAuthoringIdentity", "sourceIdentity"],
    "input.server.obligation");
    for (const name of ["mechanisms", "gapAlternatives", "packComponents"]) {
      if (!Array.isArray(server.obligation[name])) fail(
        `input.server.obligation.${name} must be an array`);
    }
    requiredString(server.obligation.expectedAuthoringIdentity,
      "input.server.obligation.expectedAuthoringIdentity");
    closedObject(server.obligation.sourceIdentity,
      Object.keys(server.obligation.sourceIdentity ?? {}),
      "input.server.obligation.sourceIdentity");
  }
  const limit = input.inlineByteLimit ?? MAX_INLINE_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 128 || limit > MAX_INLINE_BYTES) {
    fail(`input.inlineByteLimit must be an integer from 128 through ${MAX_INLINE_BYTES}`);
  }
  return { surface: input.surface, server, limit };
}

function validateDecisions(surface, server) {
  const decisions = server.authoredDecisions ?? {};
  const allowed = Object.values(AUTHORED[surface]);
  const diagnostics = [];
  const valid = new Set();
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) {
    return { valid, diagnostics: [{ code: "invalid_authored_decisions",
      field: null, message: "authoredDecisions must be a plain object" }] };
  }
  for (const field of Object.keys(decisions).sort()) {
    let okay = allowed.includes(field);
    const value = decisions[field];
    if (okay && field === "obligation_id") {
      okay = typeof value === "string" && value.length > 0;
    } else if (okay && field === "statement") {
      okay = typeof value === "string" && value === value.trim() &&
        value.length > 0 && !/[\r\n]/.test(value);
    } else if (okay && ["controlled_contract_node_ids", "node_ids"].includes(field)) {
      const nodeIds = new Set(server.contractNodes.map((node) => node?.id));
      okay = Array.isArray(value) && value.every((id) =>
        typeof id === "string" && nodeIds.has(id));
    } else if (okay && field === "mechanism") {
      okay = server.obligation.mechanisms.includes(value);
    } else if (okay && field === "gap") {
      okay = server.obligation.gapAlternatives.some((item) =>
        canonicalJson(item) === canonicalJson(value));
    } else if (okay && field === "pack_component") {
      okay = server.obligation.packComponents.some((item) =>
        canonicalJson(item) === canonicalJson(value));
    } else if (okay && field === "axes") {
      okay = value && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).sort().join() === [...AXES].sort().join() &&
        AXES.every((axis) => ACCEPTANCE_COVERAGE_STATES.includes(value[axis]));
    }
    if (okay) valid.add(field);
    else diagnostics.push({ code: "invalid_authored_decision", field,
      message: "authored decision does not match its declared alternative" });
  }
  if (valid.has("gap") && valid.has("pack_component")) {
    valid.delete("gap");
    valid.delete("pack_component");
    diagnostics.push({ code: "invalid_authored_decision_combination",
      field: "proof", message: "choose either gap or pack_component, not both" });
  }
  return { valid, diagnostics };
}

function authority(index) {
  if (index === 14) return "evolving_cas";
  if (index === 20) return "existing_transport";
  if (index >= 21 && index <= 27) return "metric";
  return Object.hasOwn(AUTHORED.obligation, index) ||
    Object.hasOwn(AUTHORED.acceptance, index) ? "caller_authored" : "server";
}

function buildEntries(normalized, decisions, requestBytes, counts = { returned: 0,
  omitted: 39 }) {
  const { surface, server } = normalized;
  const active = AUTHORED[surface];
  const unresolved = Object.entries(active).filter(([, field]) =>
    !["gap", "pack_component"].includes(field) &&
    !decisions.valid.has(field)).map(([index, field]) => ({
      reference_id: `ref-skeleton-entry-${String(index).padStart(2, "0")}`, field
    }));
  if (surface === "obligation" &&
      !decisions.valid.has("gap") && !decisions.valid.has("pack_component")) {
    unresolved.push({ reference_ids: ["ref-skeleton-entry-33",
      "ref-skeleton-entry-34"], field: "proof" });
  }
  return TERMS.map((suffix, offset) => {
    const index = offset + 1;
    const entry = { reference_id: `ref-skeleton-entry-${String(index).padStart(2, "0")}`,
      term: `wk-2439-${suffix}`, authority: authority(index) };
    if (SERVER_VALUE_FIELDS[index]) entry.value = server[SERVER_VALUE_FIELDS[index]];
    if (index === 12) entry.value = server.mutation.operation;
    if (index === 13) entry.value = server.mutation.stableArguments;
    if (index === 14) entry.value = { source: "immediately_prior_mutation_receipt",
      digest_fields: server.mutation.receiptFedDigestFields };
    if (index === 15) entry.value = unresolved;
    if (index === 16) entry.value = 39;
    if (index === 17) entry.value = counts.returned;
    if (index === 18) entry.value = counts.omitted;
    if (index === 19) entry.value_path = "inline_projection.entries";
    if (index === 20) entry.materialized_by = "existing_mcp_content_reference_transport";
    if (index === 21 || index === 25 || index === 26 || index === 27) {
      entry.capture_owner = "existing_mcp_integration_proof";
    }
    if (index === 22) entry.value = requestBytes;
    if (index === 23) entry.value_path = "facts.result_utf8_bytes";
    if (index === 24) entry.value = unresolved.length;
    const field = active[index];
    if (field) {
      entry.field = field;
      entry.status = decisions.valid.has(field) ? "authored" : "unresolved";
      if (["gap", "pack_component"].includes(field) &&
          [...decisions.valid].some((candidate) =>
            ["gap", "pack_component"].includes(candidate))) {
        entry.status = decisions.valid.has(field) ? "authored" : "alternative_not_selected";
      }
    }
    if (index === 30 || index === 37) entry.value = server.criterionIdentities;
    if (index === 32) entry.allowed_alternatives = server.obligation?.mechanisms ?? [];
    if (index === 33) entry.allowed_alternatives = server.obligation?.gapAlternatives ?? [];
    if (index === 34) entry.allowed_alternatives = server.obligation?.packComponents ?? [];
    if (index === 35) entry.value = server.obligation?.expectedAuthoringIdentity ?? null;
    if (index === 36) entry.value = server.obligation?.sourceIdentity ?? null;
    if (index === 39) entry.allowed_alternatives = Object.fromEntries(
      AXES.map((axis) => [axis, ACCEPTANCE_COVERAGE_STATES]));
    if ((index >= 28 && index <= 36 && surface !== "obligation") ||
        (index >= 37 && surface !== "acceptance")) entry.applicable = false;
    return entry;
  });
}

function selfMeasuredProjection(entries, limit) {
  let selected = [];
  let projection;
  for (const entry of entries) {
    const candidate = [...selected, entry];
    let measured = 0;
    for (;;) {
      projection = { byte_limit: limit, total: 39, returned: candidate.length,
        omitted: 39 - candidate.length, utf8_bytes: measured, entries: candidate };
      const next = bytes(projection);
      if (next === measured) break;
      measured = next;
    }
    if (projection.utf8_bytes > limit) break;
    selected = candidate;
  }
  let measured = 0;
  do {
    projection = { byte_limit: limit, total: 39, returned: selected.length,
      omitted: 39 - selected.length, utf8_bytes: measured, entries: selected };
    const next = bytes(projection);
    if (next === measured) break;
    measured = next;
  } while (true);
  return projection;
}

function composeCoverageAuthoringSkeleton(input) {
  const normalized = normalize(input);
  const requestBytes = bytes(input);
  const decisions = validateDecisions(normalized.surface, normalized.server);
  let entries;
  let inline;
  let counts = { returned: 0, omitted: 39 };
  for (;;) {
    entries = buildEntries(normalized, decisions, requestBytes, counts);
    const gapFirst = [...entries].sort((left, right) =>
      Number(right.status === "unresolved") - Number(left.status === "unresolved"));
    inline = selfMeasuredProjection(gapFirst, normalized.limit);
    const next = { returned: inline.returned, omitted: inline.omitted };
    if (next.returned === counts.returned && next.omitted === counts.omitted) break;
    counts = next;
  }
  const unresolved = entries[14].value;
  const diagnostics = [...decisions.diagnostics,
    ...unresolved.map(({ reference_id, reference_ids, field }) => ({
      code: "unresolved_semantic_slot", ...(reference_id
        ? { reference_id } : { reference_ids }), field
    }))];
  if (inline.omitted > 0) diagnostics.push({
    code: "inline_projection_bound_overflow", byte_limit: normalized.limit,
    omitted: inline.omitted
  });
  const result = {
    schema_version: "coverage-authoring-skeleton.v1",
    projection_visibility: "internal_only",
    surface: normalized.surface,
    complete_population: entries,
    inline_projection: inline,
    mutation_handoff: {
      operation: normalized.server.mutation.operation,
      stable_arguments: normalized.server.mutation.stableArguments,
      authored_fields: Object.values(AUTHORED[normalized.surface]),
      call_shape: normalized.server.mutation.receiptFedDigestFields.length > 0
        ? "single_row" : "complete_population",
      receipt_fed_digest_state: normalized.server.mutation.receiptFedDigestFields.length > 0
        ? { source: "immediately_prior_mutation_receipt",
          fields: normalized.server.mutation.receiptFedDigestFields }
        : null
    },
    diagnostics,
    facts: {
      request_utf8_bytes: requestBytes, result_utf8_bytes: 0,
      intended_entry_count: 39, returned_entry_count: inline.returned,
      omitted_entry_count: inline.omitted, unresolved_slot_count: unresolved.length
    }
  };
  for (;;) {
    const measured = bytes(result);
    if (measured === result.facts.result_utf8_bytes) break;
    result.facts.result_utf8_bytes = measured;
  }
  return result;
}

export { composeCoverageAuthoringSkeleton };

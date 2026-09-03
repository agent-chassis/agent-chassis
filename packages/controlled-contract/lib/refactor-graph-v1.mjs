import { canonicalValue, compareCodeUnits, deepFreeze, sha256 } from
  "./deterministic-projection-primitives.mjs";
import { applyControlledContractCarrierPatch } from "./carrier-patch-v1.mjs";

const REFACTOR_GRAPH_SCHEMA_VERSION = "controlled-contract-refactor-graph.v1";
const REFACTOR_MODES = Object.freeze(["rename_identity", "replace_subgraph"]);
const REFACTOR_GRAPH_LIMITS = Object.freeze({
  carrier_count: 64, carrier_bytes: 4 * 1024 * 1024,
  total_bytes: 16 * 1024 * 1024, identity_count: 16384,
  correspondence_count: 4096, unresolved_identity_count: 256
});
const ID_FIELDS = new Set([
  "acceptance_id", "annotation_id", "assessment_id", "binding_id", "claim_id",
  "collection_id", "controlled_contract_node_id", "criterion_id",
  "criterion_identity", "evidence_id", "generation_id", "node_id",
  "obligation_id", "proof_id", "proof_plan_id", "proposition_id",
  "reference_id", "relation_id", "requirement_id", "residue_id",
  "source_assessment_id", "source_generation_id", "source_proof_plan_id",
  "stable_test_proof_id", "verification_claim_id", "verification_id"
]);
const ID_ARRAY_FIELDS = new Set([
  "acceptance_ids", "claim_ids", "collection_ids",
  "controlled_contract_node_ids", "criterion_identities", "node_ids",
  "obligation_ids", "proof_ids", "proposition_ids", "reference_ids",
  "relation_ids", "requirement_ids", "verification_ids"
]);
const DERIVED_KINDS = new Set(["assessment", "proof_plan"]);
const REQUEST_FIELDS = ["live_carriers", "mode"];
const RENAME_FIELDS = ["kind", "old_identity", "new_identity", "old_node", "new_node"];
const REPLACE_FIELDS = ["kind", "correspondence", "reason", "carrier_operations"];

class ControlledContractRefactorError extends Error {
  constructor({ code, message, decidingFacts = [], wouldBreak, recovery = null }) {
    super(message);
    this.name = "ControlledContractRefactorError";
    this.code = code;
    this.limb = "mechanical_failure";
    this.owner = "controlled_contract_refactor_graph";
    this.deciding_facts = deepFreeze(structuredClone(decidingFacts));
    this.would_break = wouldBreak;
    this.recovery = recovery === null ? null : deepFreeze(structuredClone(recovery));
    this.details = deepFreeze({ limb: this.limb, owner: this.owner, code,
      deciding_facts: structuredClone(decidingFacts), would_break: wouldBreak,
      recovery: recovery === null ? null : structuredClone(recovery) });
  }
}

function refuse(code, message, decidingFacts, wouldBreak, recovery = null) {
  throw new ControlledContractRefactorError({ code, message, decidingFacts,
    wouldBreak, recovery });
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function assertClosed(value, fields, pointer) {
  if (!isPlainObject(value)) refuse("controlled_contract_refactor_input_invalid",
    `${pointer || "request"} must be one plain object`,
    [{ field: "pointer", value: pointer }],
    "closed refactor input validation would be bypassed");
  const unknown = Reflect.ownKeys(value).filter((key) =>
    typeof key !== "string" || !fields.includes(key)).map(String).sort(compareCodeUnits);
  if (unknown.length > 0) refuse("controlled_contract_refactor_input_invalid",
    `${pointer || "request"} contains unsupported fields`,
    [{ field: "pointer", value: pointer }, { field: "unknown", value: unknown }],
    "caller-controlled semantics or authority could enter the package boundary");
}
function digest(value) {
  return `sha256:${sha256(Buffer.from(JSON.stringify(canonicalValue(value)), "utf8"))}`;
}

function normalizeCarriers(input) {
  const rows = Array.isArray(input) ? input : isPlainObject(input)
    ? Object.entries(input).map(([carrier_kind, content]) => ({ carrier_kind, content }))
    : null;
  if (rows === null || rows.length === 0 || rows.length > REFACTOR_GRAPH_LIMITS.carrier_count)
    refuse("controlled_contract_refactor_live_population_invalid",
      "live_carriers must be one non-empty bounded complete population",
      [{ field: "carrier_count", value: rows?.length ?? null }],
      "the refactor closure would not describe one complete current population");
  const seen = new Set();
  let totalBytes = 0;
  const normalized = rows.map((row, index) => {
    if (!isPlainObject(row) || typeof row.carrier_kind !== "string" ||
        row.carrier_kind.length === 0 || !Object.hasOwn(row, "content"))
      refuse("controlled_contract_refactor_live_population_invalid",
        "each live carrier requires carrier_kind and complete content",
        [{ field: "carrier_index", value: index }],
        "an incomplete carrier could hide a live identity edge");
    if (seen.has(row.carrier_kind)) refuse(
      "controlled_contract_refactor_live_population_invalid",
      "live carrier kinds must be unique", [{ field: "carrier_kind", value: row.carrier_kind }],
      "two competing current carriers would make closure ambiguous");
    seen.add(row.carrier_kind);
    const bytes = Buffer.byteLength(JSON.stringify(row.content), "utf8");
    totalBytes += bytes;
    if (bytes > REFACTOR_GRAPH_LIMITS.carrier_bytes ||
        totalBytes > REFACTOR_GRAPH_LIMITS.total_bytes)
      refuse("controlled_contract_refactor_bound_exceeded",
        "the complete live carrier population exceeds package bounds",
        [{ field: "carrier_kind", value: row.carrier_kind },
          { field: "carrier_bytes", value: bytes },
          { field: "total_bytes", value: totalBytes }],
        "the package could not establish a bounded complete graph");
    return { carrier_kind: row.carrier_kind,
      filename: typeof row.filename === "string" ? row.filename : null,
      content: structuredClone(row.content),
      content_digest: typeof row.content_digest === "string"
        ? row.content_digest : digest(row.content),
      generation_id: row.generation_id ?? null, current: row.current !== false,
      mutable: row.mutable !== false };
  });
  return normalized.sort((left, right) =>
    compareCodeUnits(left.carrier_kind, right.carrier_kind));
}

function normalizeMode(mode) {
  if (!isPlainObject(mode) || !REFACTOR_MODES.includes(mode.kind))
    refuse("controlled_contract_refactor_mode_invalid",
      "mode.kind must be rename_identity or replace_subgraph",
      [{ field: "mode.kind", value: mode?.kind ?? null }],
      "the package could not choose one deterministic semantic classification");
  if (mode.kind === "rename_identity") {
    assertClosed(mode, RENAME_FIELDS, "/mode");
    if (typeof mode.old_identity !== "string" || mode.old_identity.length === 0 ||
        typeof mode.new_identity !== "string" || mode.new_identity.length === 0 ||
        mode.old_identity === mode.new_identity)
      refuse("controlled_contract_refactor_rename_identity_invalid",
        "rename_identity requires two distinct non-empty stable identities",
        [{ field: "old_identity", value: mode.old_identity ?? null },
          { field: "new_identity", value: mode.new_identity ?? null }],
        "identity graph isomorphism could not be established");
    return structuredClone(mode);
  }
  assertClosed(mode, REPLACE_FIELDS, "/mode");
  if (typeof mode.reason !== "string" || mode.reason.trim().length === 0)
    refuse("controlled_contract_refactor_replace_reason_required",
      "replace_subgraph requires one non-empty reason",
      [{ field: "mode.reason", value: mode.reason ?? null }],
      "a semantic replacement would lack an explicit author rationale");
  if (!Array.isArray(mode.correspondence) || mode.correspondence.length === 0 ||
      mode.correspondence.length > REFACTOR_GRAPH_LIMITS.correspondence_count)
    refuse("controlled_contract_refactor_correspondence_invalid",
      "replace_subgraph requires a bounded explicit correspondence",
      [{ field: "correspondence_count", value: mode.correspondence?.length ?? null }],
      "changed requirements could receive implicit identity or proof credit");
  const seenOld = new Set();
  const correspondence = mode.correspondence.map((row, index) => {
    assertClosed(row, ["old_identity", "new_identities"],
      `/mode/correspondence/${index}`);
    if (!((typeof row.old_identity === "string" && row.old_identity.length > 0) ||
          row.old_identity === null) ||
        !Array.isArray(row.new_identities) || row.new_identities.some(
          (identity) => typeof identity !== "string" || identity.length === 0) ||
        new Set(row.new_identities).size !== row.new_identities.length ||
        (row.old_identity !== null && seenOld.has(row.old_identity)) ||
        (row.old_identity === null && row.new_identities.length === 0))
      refuse("controlled_contract_refactor_correspondence_invalid",
        "correspondence rows require one unique old identity or one pure addition and unique new identities",
        [{ field: "correspondence_index", value: index }],
        "split, merge, add, or removal semantics would be ambiguous");
    if (row.old_identity !== null) seenOld.add(row.old_identity);
    return { old_identity: row.old_identity,
      new_identities: [...row.new_identities].sort(compareCodeUnits) };
  });
  correspondence.sort((left, right) => compareCodeUnits(
    `${left.old_identity ?? ""}\0${left.new_identities.join("\0")}`,
    `${right.old_identity ?? ""}\0${right.new_identities.join("\0")}`));
  return { ...structuredClone(mode), correspondence };
}

function isIdentity(key, value) {
  return typeof value === "string" && (ID_FIELDS.has(key) ||
    /(?:^|_)id$/u.test(key));
}
function walk(value, visitor, pointer = "", parentKey = "") {
  if (Array.isArray(value)) {
    value.forEach((member, index) => {
      const child = `${pointer}/${index}`;
      if (typeof member === "string" && (ID_ARRAY_FIELDS.has(parentKey) ||
          /(?:^|_)ids$/u.test(parentKey))) visitor(member, child, parentKey);
      walk(member, visitor, child, parentKey);
    });
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    const member = value[key];
    const child = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (isIdentity(key, member)) visitor(member, child, key);
    walk(member, visitor, child, key);
  }
}
function identityIndex(carriers) {
  const index = new Map();
  for (const carrier of carriers) walk(carrier.content, (identity, pointer, field) => {
    const rows = index.get(identity) ?? [];
    rows.push({ carrier_kind: carrier.carrier_kind, pointer, field,
      mutable: carrier.mutable, current: carrier.current });
    index.set(identity, rows);
  });
  if (index.size > REFACTOR_GRAPH_LIMITS.identity_count)
    refuse("controlled_contract_refactor_bound_exceeded",
      "the live identity population exceeds the package bound",
      [{ field: "identity_count", value: index.size }],
      "the package could not establish bounded identity closure");
  for (const rows of index.values()) rows.sort((left, right) =>
    compareCodeUnits(`${left.carrier_kind}${left.pointer}`,
      `${right.carrier_kind}${right.pointer}`));
  return index;
}
function replaceIdentity(value, from, to, parentKey = "") {
  if (Array.isArray(value)) return value.map((member) =>
    typeof member === "string" && (ID_ARRAY_FIELDS.has(parentKey) ||
      /(?:^|_)ids$/u.test(parentKey)) && member === from
      ? to : replaceIdentity(member, from, to, parentKey));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [key,
    isIdentity(key, member) && member === from
      ? to : replaceIdentity(member, from, to, key)]));
}
function normalizedNode(value, identity) {
  return canonicalValue(replaceIdentity(structuredClone(value), identity,
    "__controlled_contract_identity__"));
}
function closureRows(index, identities) {
  return [...identities].sort(compareCodeUnits).flatMap((identity) =>
    (index.get(identity) ?? []).map((row) => ({ identity, ...row })));
}

const DECLARATION_SEGMENTS = Object.freeze({
  acceptance_id: "acceptances", annotation_id: "annotations",
  assessment_id: "assessments", claim_id: "claims", collection_id: "collections",
  criterion_identity: "rows", evidence_id: "evidence", node_id: "nodes",
  obligation_id: "obligations", proof_id: "test_proofs", proof_plan_id: "proof_plans",
  proposition_id: "propositions", reference_id: "references",
  relation_id: "relations", requirement_id: "requirements", residue_id: "residue",
  stable_test_proof_id: "test_proofs", test_proof_id: "test_proofs",
  boundary_id: "system_under_test_boundary", observable_id: "observable_result",
  falsifier_id: "falsifiers", mutation_id: "mutation",
  baseline_id: "coverage_disposition", verification_id: "verifications"
});

function refactorIntegrity(carriers, index) {
  const declarations = new Set();
  for (const [identity, occurrences] of index) {
    if (occurrences.some(({ carrier_kind: carrierKind, field, pointer }) => {
      const segment = DECLARATION_SEGMENTS[field];
      return (segment !== undefined && pointer.includes(`/${segment}/`)) ||
        (carrierKind === "assessment" && field === "assessment_id") ||
        (carrierKind === "proof_plan" && field === "proof_plan_id");
    })) declarations.add(identity);
  }
  const ignoredExternal = new Set(["generation_id", "source_generation_id",
    "source_assessment_id", "source_proof_plan_id", "profile_id", "provider_id",
    "pack_id", "wk_id", "component_id"]);
  const dangling = [];
  const orphanProofs = [];
  const absentCoverage = [];
  for (const [identity, occurrences] of index) {
    if (declarations.has(identity)) continue;
    for (const occurrence of occurrences) {
      if (ignoredExternal.has(occurrence.field)) continue;
      const row = { identity, carrier_kind: occurrence.carrier_kind,
        pointer: occurrence.pointer, field: occurrence.field };
      if (["stable_test_proof", "test_proof", "verification_bundle"].includes(
        occurrence.carrier_kind)) orphanProofs.push(row);
      else if (["obligation_coverage", "acceptance_coverage"].includes(
        occurrence.carrier_kind)) absentCoverage.push(row);
      else dangling.push(row);
    }
  }
  const generations = [...new Set(carriers.map(({ generation_id }) => generation_id)
    .filter((value) => value !== null))].sort(compareCodeUnits);
  const staleDerived = carriers.filter(({ carrier_kind, current }) =>
    DERIVED_KINDS.has(carrier_kind) && current === false).map(
      ({ carrier_kind, content_digest }) => ({ carrier_kind, content_digest }));
  const order = (rows) => rows.sort((left, right) =>
    compareCodeUnits(`${left.identity ?? ""}\0${left.carrier_kind}\0${left.pointer ?? ""}`,
      `${right.identity ?? ""}\0${right.carrier_kind}\0${right.pointer ?? ""}`));
  return deepFreeze({
    dangling_live_nodes: order(dangling),
    orphan_verification_bindings: order(orphanProofs),
    absent_node_coverage_mappings: order(absentCoverage),
    stale_derived_carriers: order(staleDerived),
    generation_identity_conflicts: generations.length <= 1 ? [] : generations.map(
      (generation_id) => ({ generation_id })),
    generation_identities: generations
  });
}

function unresolvedIntegrityIdentities(integrity) {
  const identities = new Set();
  for (const field of ["dangling_live_nodes", "orphan_verification_bindings",
    "absent_node_coverage_mappings"]) {
    for (const row of integrity[field]) identities.add(row.identity);
  }
  return [...identities].sort(compareCodeUnits);
}

function refuseUnresolvedIdentities(integrity) {
  const identities = unresolvedIntegrityIdentities(integrity);
  if (identities.length === 0) return;
  const bounded = identities.slice(0, REFACTOR_GRAPH_LIMITS.unresolved_identity_count);
  if (identities.length > REFACTOR_GRAPH_LIMITS.unresolved_identity_count) {
    refuse("controlled_contract_refactor_bound_exceeded",
      "the unresolved live identity population exceeds the package bound",
      [{ field: "unresolved_identity_count", value: identities.length },
        { field: "unresolved_identity_limit",
          value: REFACTOR_GRAPH_LIMITS.unresolved_identity_count },
        { field: "bounded_unresolved_identities", value: bounded }],
      "the package could not return a bounded exact unresolved identity population");
  }
  const error = new ControlledContractRefactorError({
    code: "controlled_contract_refactor_closure_incomplete",
    message: "the complete live population contains unresolved identities",
    decidingFacts: [
      { field: "unresolved_identity_count", value: identities.length },
      { field: "unresolved_identities", value: identities }
    ], wouldBreak: "refactor planning could proceed without complete live identity closure",
    recovery: { operation: "workspace_controlled_contract_refactor_plan" }
  });
  error.integrity = integrity;
  error.result_digest = digest({ code: error.code, integrity });
  throw error;
}

function classifyRename(carriers, index, mode) {
  if (!index.has(mode.old_identity)) refuse(
    "controlled_contract_refactor_identity_unknown",
    "the renamed identity is not live in the complete population",
    [{ field: "old_identity", value: mode.old_identity }],
    "an unknown identity could not be closed",
    { operation: "workspace_controlled_contract_refactor_plan", arguments: { mode } });
  if (index.has(mode.new_identity)) refuse(
    "controlled_contract_refactor_identity_conflict",
    "the requested new identity is already live",
    [{ field: "new_identity", value: mode.new_identity }],
    "identity-only rename would cease to be bijective");
  if (Object.hasOwn(mode, "old_node") || Object.hasOwn(mode, "new_node")) {
    if (!Object.hasOwn(mode, "old_node") || !Object.hasOwn(mode, "new_node") ||
        JSON.stringify(normalizedNode(mode.old_node, mode.old_identity)) !==
        JSON.stringify(normalizedNode(mode.new_node, mode.new_identity)))
      refuse("controlled_contract_refactor_rename_semantic_change",
        "rename_identity cannot change proposition, modality, applicability, verification, relation, collection, or proof semantics",
        [{ field: "old_identity", value: mode.old_identity },
          { field: "new_identity", value: mode.new_identity }],
        "graph and semantic equivalence would not hold",
        { operation: "workspace_controlled_contract_refactor_plan",
          arguments: { mode: { kind: "replace_subgraph" } } });
  }
  return { classification: "identity_equivalent", reason: null,
    correspondence: [{ old_identity: mode.old_identity,
      new_identities: [mode.new_identity] }],
    affected_identities: [mode.old_identity, mode.new_identity],
    closure: closureRows(index, [mode.old_identity]),
    prospective: carriers.map((carrier) => ({ ...carrier,
      content: replaceIdentity(carrier.content, mode.old_identity, mode.new_identity) })),
    invalidated_derived: carriers.filter(({ carrier_kind }) =>
      DERIVED_KINDS.has(carrier_kind)).map(({ carrier_kind, content_digest }) => ({
        carrier_kind, content_digest, currentness: "stale_after_apply" })) };
}

function classifyReplace(carriers, index, mode) {
  const old = mode.correspondence.map(({ old_identity }) => old_identity)
    .filter((identity) => identity !== null);
  const additions = mode.correspondence.filter(({ old_identity }) =>
    old_identity === null).flatMap(({ new_identities }) => new_identities);
  const unknown = old.filter((identity) => !index.has(identity));
  if (unknown.length > 0) refuse("controlled_contract_refactor_identity_unknown",
    "replace_subgraph correspondence contains identities outside the live closure",
    [{ field: "unknown_identities", value: unknown.sort(compareCodeUnits) }],
    "a replacement could leave untreated live edges",
    { operation: "workspace_controlled_contract_refactor_plan" });
  const existingAdditions = additions.filter((identity) => index.has(identity));
  if (existingAdditions.length > 0) refuse(
    "controlled_contract_refactor_correspondence_invalid",
    "pure additions must name identities absent from the source graph",
    [{ field: "existing_addition_identities",
      value: [...new Set(existingAdditions)].sort(compareCodeUnits) }],
    "addition correspondence would fabricate semantic change and proof gaps",
    { operation: "workspace_controlled_contract_refactor_plan" });
  const allNew = mode.correspondence.flatMap(({ new_identities }) => new_identities);
  const operations = Array.isArray(mode.carrier_operations)
    ? structuredClone(mode.carrier_operations) : [];
  if (operations.some((operation) => !isPlainObject(operation) ||
      typeof operation.carrier_kind !== "string" || !Array.isArray(operation.operations)))
    refuse("controlled_contract_refactor_replace_operations_invalid",
      "carrier_operations must be explicit bounded carrier patch requests", [],
      "prospective carrier bytes could not be delegated to the patch owner");
  const operationKindCounts = new Map();
  for (const { carrier_kind } of operations) operationKindCounts.set(carrier_kind,
    (operationKindCounts.get(carrier_kind) ?? 0) + 1);
  const duplicateKinds = [...operationKindCounts].filter(([, count]) => count > 1)
    .map(([carrier_kind]) => carrier_kind).sort(compareCodeUnits);
  if (duplicateKinds.length > 0) refuse(
    "controlled_contract_refactor_replace_operations_invalid",
    "carrier_operations may name each live carrier exactly once",
    [{ field: "duplicate_carrier_kinds", value: duplicateKinds }],
    "competing prospective bytes would make closure ambiguous");
  const unknownKinds = operations.filter(({ carrier_kind }) =>
    !carriers.some((carrier) => carrier.carrier_kind === carrier_kind))
    .map(({ carrier_kind }) => carrier_kind).sort(compareCodeUnits);
  if (unknownKinds.length > 0) refuse(
    "controlled_contract_refactor_replace_operations_invalid",
    "carrier_operations name carriers outside the complete live population",
    [{ field: "unknown_carrier_kinds", value: unknownKinds }],
    "prospective closure could include caller-invented carriers");
  const prospective = carriers.map((carrier) => {
    const request = operations.find((operation) =>
      operation.carrier_kind === carrier.carrier_kind);
    if (request === undefined) return carrier;
    let patched;
    try {
      patched = applyControlledContractCarrierPatch({ content: carrier.content,
        carrierKind: carrier.carrier_kind, operations: request.operations });
    } catch (error) {
      refuse(error?.code ?? "controlled_contract_refactor_replace_operations_invalid",
        error?.message ?? "carrier patch owner rejected replacement operations",
        [{ field: "carrier_kind", value: carrier.carrier_kind },
          { field: "owner", value: "controlled_contract_carrier_patch" }],
        "prospective carrier bytes could not be mechanically established");
    }
    return { ...carrier, content: patched.content };
  });
  const prospectiveLive = prospective.filter(({ carrier_kind, mutable }) =>
    mutable && !DERIVED_KINDS.has(carrier_kind) &&
    !["obligation_coverage", "acceptance_coverage"].includes(carrier_kind));
  const prospectiveIndex = identityIndex(prospectiveLive);
  const untreated = old.filter((identity) => prospectiveIndex.has(identity));
  const absentNew = allNew.filter((identity) => !prospectiveIndex.has(identity));
  const changedCarrierKinds = new Set(prospective.filter((carrier, ordinal) =>
    digest(carrier.content) !== digest(carriers[ordinal].content))
    .map(({ carrier_kind }) => carrier_kind));
  const additionsWithoutCarrierChange = additions.filter((identity) =>
    !(prospectiveIndex.get(identity) ?? []).some(({ carrier_kind }) =>
      changedCarrierKinds.has(carrier_kind)));
  if (untreated.length > 0 || absentNew.length > 0 ||
      additionsWithoutCarrierChange.length > 0) refuse(
    "controlled_contract_refactor_closure_incomplete",
    "replace_subgraph must treat every old edge and materialize every mapped identity",
    [{ field: "untreated_old_identities", value: untreated.sort(compareCodeUnits) },
      { field: "absent_new_identities", value: absentNew.sort(compareCodeUnits) },
      { field: "addition_identities_without_carrier_change",
        value: [...new Set(additionsWithoutCarrierChange)].sort(compareCodeUnits) }],
    "the prospective graph would not implement the explicit correspondence",
    { operation: "workspace_controlled_contract_refactor_plan" });
  return { classification: "semantic_replacement", reason: mode.reason.trim(),
    correspondence: mode.correspondence,
    affected_identities: [...new Set([...old, ...allNew])].sort(compareCodeUnits),
    closure: closureRows(index, old), prospective,
    carrier_operations: operations,
    coverage_rebase: { obligation: null, acceptance: null,
      owner: "existing_coverage_rebase_operations" },
    proof_gaps: mode.correspondence.flatMap(({ old_identity, new_identities }) =>
      new_identities.length === 0
        ? [{ old_identity, new_identity: null, change: "removal",
          proof_credit: "not_transferred", disposition: "explicit_gap_required" }]
        : new_identities.map((new_identity) => ({ old_identity, new_identity,
          change: old_identity === null ? "addition" : "replacement",
          proof_credit: "not_transferred", disposition: "explicit_gap_required" }))),
    invalidated_derived: carriers.filter(({ carrier_kind }) =>
      DERIVED_KINDS.has(carrier_kind)).map(({ carrier_kind, content_digest }) => ({
        carrier_kind, content_digest, currentness: "stale_after_apply" })) };
}

function buildControlledContractRefactorClosure(request, ...unexpected) {
  if (unexpected.length > 0) refuse("controlled_contract_refactor_input_invalid",
    "the primitive accepts exactly one request object", [],
    "multiple inputs could bypass the closed semantic boundary");
  assertClosed(request, REQUEST_FIELDS, "");
  const carriers = normalizeCarriers(request.live_carriers);
  const mode = normalizeMode(request.mode);
  const index = identityIndex(carriers);
  const integrity = refactorIntegrity(carriers, index);
  refuseUnresolvedIdentities(integrity);
  const result = mode.kind === "rename_identity"
    ? classifyRename(carriers, index, mode) : classifyReplace(carriers, index, mode);
  const projectedCarriers = result.prospective.map((carrier) => {
    const prospectiveDigest = digest(carrier.content);
    return { carrier_kind: carrier.carrier_kind,
      filename: carrier.filename,
      source_content_digest: carrier.content_digest,
      prospective_content_digest: prospectiveDigest,
      changed: carrier.content_digest !== prospectiveDigest,
      generation_id: carrier.generation_id, content: canonicalValue(carrier.content) };
  });
  const complete = { schema_version: REFACTOR_GRAPH_SCHEMA_VERSION,
    mode: mode.kind, classification: result.classification,
    semantic_equivalence: mode.kind === "rename_identity",
    correspondence: result.correspondence, reason: result.reason,
    affected_identities: result.affected_identities, closure: result.closure,
    carriers: projectedCarriers, carrier_operations: result.carrier_operations ?? [],
    coverage_rebase: result.coverage_rebase ?? { obligation: null, acceptance: null,
      owner: "existing_coverage_rebase_operations" },
    proof_gaps: result.proof_gaps ?? [],
    invalidated_derived: result.invalidated_derived ?? [],
    unresolved_identities: [],
    integrity,
    counts: { live_carriers: carriers.length, live_identities: index.size,
      closure_edges: result.closure.length,
      affected_identities: result.affected_identities.length,
      proof_gaps: result.proof_gaps?.length ?? 0,
      invalidated_derived: result.invalidated_derived?.length ?? 0 },
    failure_contract: { limbs: ["mechanical_failure", "returned_policy_decision"],
      package_limb: "mechanical_failure", policy_synthesized: false },
    authority: "non_authoritative", proof_credit_transferred: false,
    carriers_written: false };
  return deepFreeze({ ...complete, result_digest: digest(complete) });
}

function planControlledContractRefactor(request, ...unexpected) {
  return buildControlledContractRefactorClosure(request, ...unexpected);
}

export { ControlledContractRefactorError, REFACTOR_GRAPH_LIMITS,
  REFACTOR_GRAPH_SCHEMA_VERSION, REFACTOR_MODES,
  buildControlledContractRefactorClosure, planControlledContractRefactor };

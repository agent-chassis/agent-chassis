

const CARRIER_TARGETS = Object.freeze({
  contract: Object.freeze({ references: "reference_id", propositions: "proposition_id", claims: "claim_id", relations: "relation_id", collections: "collection_id", residue: "residue_id", annotations: "annotation_id" }),
  evaluation_input: Object.freeze({ reference_bindings: "role", number_bindings: "role", claim_pattern_bindings: "claim_pattern", resolver_facts: "resolver_fact", delivered_evidence: "delivered_evidence", evaluation_stage: "scalar" }),
  proof_plan_request: Object.freeze({ requested_intents: "value", selected_packs: "pack" }),
  obligation_coverage: Object.freeze({ obligations: "obligation_id" }),
  acceptance_coverage: Object.freeze({ rows: "criterion_identity" })
});

const CARRIER_PATCH_LIMITS = Object.freeze({
  operation_bytes: 16384,
  request_bytes: 65536
});

function fail(code, message, details = {}) { const error = new Error(message); error.code = code; error.details = details; throw error; }

function packId(value) { return `${value?.profile_id ?? ""}@${value?.profile_version ?? ""}`; }

function compoundId(target, value) {
  if (target === "claim_pattern_bindings") return `${value?.pattern_id ?? ""}=>${value?.claim_id ?? ""}`;
  if (target === "resolver_facts") return Buffer.from(JSON.stringify([value?.resolver_kind, value?.fact_key, value?.argument_reference_ids ?? []])).toString("base64url");
  if (target === "delivered_evidence") return `${value?.evidence_kind ?? ""}=>${value?.verification_claim_id ?? ""}`;
  return null; }

function carrierValueId(target, rule, value) {
  if (rule === "value") return value; if (rule === "pack") return packId(value);
  if (["claim_pattern", "resolver_fact", "delivered_evidence"].includes(rule)) return compoundId(target, value);
  if (rule === "scalar") return target; return value?.[rule];
}

function carrierPatchRequestProjection(carrierKind, operations) {
  return { carrier_kind: carrierKind, operations };
}

function applyControlledContractCarrierPatch({ content, carrierKind, operations }) {
  const targets = CARRIER_TARGETS[carrierKind]; const requestBytes = Buffer.byteLength(JSON.stringify(carrierPatchRequestProjection(carrierKind, operations)), "utf8");
  if (!targets || !Array.isArray(operations) || operations.length === 0 || requestBytes > CARRIER_PATCH_LIMITS.request_bytes)
    fail("controlled_contract_patch_request_too_large", "patch must be non-empty and within 65,536 UTF-8 bytes", { byte_length: requestBytes });
  const next = structuredClone(content); const removed = new Map();
  for (const operation of operations) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation) || Buffer.byteLength(JSON.stringify(operation), "utf8") > CARRIER_PATCH_LIMITS.operation_bytes)
      fail("controlled_contract_patch_operation_too_large", "each patch operation must be a bounded plain object");
    const allowed = new Set(["op", "target", "id", "value"]); if (Reflect.ownKeys(operation).some((key) => typeof key !== "string" ||
        !allowed.has(key)) || !["upsert", "remove"].includes(operation.op) || !Object.hasOwn(targets, operation.target))
      fail("controlled_contract_patch_operation_invalid", "patch operation is not a supported typed domain operation");
    const rule = targets[operation.target]; const id = operation.id ?? (operation.value === undefined ? null
      : carrierValueId(operation.target, rule, operation.value));
    if (typeof id !== "string" || id.length === 0)
      fail("controlled_contract_patch_identity_invalid", "patch operation requires a returned stable selector");
    if (rule === "scalar") {
      if (operation.op === "remove") delete next[operation.target];
      else { if (id !== operation.target || operation.value === undefined) fail("controlled_contract_patch_value_invalid",
        "scalar upsert must use its returned selector and a value"); next[operation.target] = structuredClone(operation.value); }
      continue;
    }

    if (next[operation.target] === undefined || next[operation.target] === null) next[operation.target] = [];
    if (!Array.isArray(next[operation.target])) fail("controlled_contract_patch_operation_invalid",
      "typed domain target is not a JSON array in this carrier", { target: operation.target });
    const idOf = (value) => carrierValueId(operation.target, rule, value);
    const index = next[operation.target].findIndex((value) => idOf(value) === id);
    const positionKey = `${operation.target}\0${id}`;
    if (operation.op === "remove") {
      if (index >= 0) { removed.set(positionKey, index); next[operation.target].splice(index, 1); }
    } else {
      if (operation.value === undefined || idOf(operation.value) !== id) fail("controlled_contract_patch_value_invalid",
        "upsert value must carry the returned stable selector identity");
      if (index < 0) next[operation.target].splice(removed.get(positionKey) ?? next[operation.target].length, 0, structuredClone(operation.value));
      else next[operation.target][index] = structuredClone(operation.value);
    }
  }
  return Object.freeze({
    content: next,
    changed: JSON.stringify(next) !== JSON.stringify(content),
    operation_count: operations.length,
    upsert_count: operations.filter(({ op }) => op === "upsert").length,
    remove_count: operations.filter(({ op }) => op === "remove").length
  });
}

export {
  CARRIER_PATCH_LIMITS,
  CARRIER_TARGETS,
  applyControlledContractCarrierPatch,
  carrierPatchRequestProjection,
  carrierValueId
};

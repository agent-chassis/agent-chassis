export const AUTHORING_LIMITS = Object.freeze({ index: 4096, selected: 16384 });
export const CARRIER_TARGETS = Object.freeze({
  contract: Object.freeze({ references: "reference_id", propositions: "proposition_id", claims: "claim_id", relations: "relation_id", collections: "collection_id", residue: "residue_id", annotations: "annotation_id" }),
  evaluation_input: Object.freeze({ reference_bindings: "role", number_bindings: "role", claim_pattern_bindings: "claim_pattern", resolver_facts: "resolver_fact", delivered_evidence: "delivered_evidence", evaluation_stage: "scalar" }),
  proof_plan_request: Object.freeze({ requested_intents: "value", selected_packs: "pack" })
});
export const IMMUTABLE_CARRIER_FIELDS = Object.freeze({ contract: ["schema_version", "vocabulary_version", "profile_id"],
  evaluation_input: ["input_version"], proof_plan_request: ["schema_version"] });
const PROJECTION_SPILLS = new WeakMap();
function fail(code, message, details = {}) { const error = new Error(message); error.code = code; error.details = details; throw error; }
function bytes(value) { return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8"); }
function packId(value) { return `${value?.profile_id ?? ""}@${value?.profile_version ?? ""}`; }
function compoundId(target, value) {
  if (target === "claim_pattern_bindings") return `${value?.pattern_id ?? ""}=>${value?.claim_id ?? ""}`;
  if (target === "resolver_facts") return Buffer.from(JSON.stringify([value?.resolver_kind, value?.fact_key, value?.argument_reference_ids ?? []])).toString("base64url");
  if (target === "delivered_evidence") return `${value?.evidence_kind ?? ""}=>${value?.verification_claim_id ?? ""}`;
  return null; }
export function carrierValueId(target, rule, value) {
  if (rule === "value") return value; if (rule === "pack") return packId(value);
  if (["claim_pattern", "resolver_fact", "delivered_evidence"].includes(rule)) return compoundId(target, value);
  if (rule === "scalar") return target; return value?.[rule];
}
export function controlledContractCarrierItems(content, carrierKind) {
  const items = []; for (const [target, rule] of Object.entries(CARRIER_TARGETS[carrierKind] ?? {})) {
    const values = rule === "scalar" ? (Object.hasOwn(content, target) ? [content[target]] : []) : content[target] ?? [];
    for (const value of values) { const id = carrierValueId(target, rule, value); items.push({ target, id, selector: id, value }); }
  }
  return items; }
function encodeCursor(binding) { return Buffer.from(JSON.stringify(binding)).toString("base64url"); }
function decodeCursor(cursor, expected) {
  let value; try { value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
  catch { fail("controlled_contract_query_cursor_invalid", "continuation cursor is malformed"); }
  for (const [key, expectedValue] of Object.entries(expected)) if (value?.[key] !== expectedValue)
    fail("controlled_contract_query_cursor_mismatch", "continuation cursor belongs to another carrier or filter", { field: key });
  if (!Number.isInteger(value.offset) || value.offset < 0) fail("controlled_contract_query_cursor_invalid", "continuation cursor offset is invalid"); return value.offset;
}
function queryBase(carrier, selection) { return { schema_version: "controlled-contract-carrier-query.v2", wk_id: carrier.wk_id,
  focus: carrier.focus, carrier_kind: carrier.carrier_kind, content_digest: carrier.content_digest, selection }; }
function population(items) { const by_target = Object.fromEntries(Object.keys(CARRIER_TARGETS[items.carrierKind] ?? {}).map((target) =>
    [target, items.values.filter((item) => item.target === target).length])); return { total: items.values.length, by_target };
}
function indexProjection(carrier, { target = null, filter = null, cursor = null }) {
  const values = controlledContractCarrierItems(carrier.content, carrier.carrier_kind).sort((a, b) => {
    const left = `${a.target}\0${a.id}`; const right = `${b.target}\0${b.id}`; return left < right ? -1 : left > right ? 1 : 0;
  });
  if (target !== null && !Object.hasOwn(CARRIER_TARGETS[carrier.carrier_kind] ?? {}, target)) fail(
    "controlled_contract_query_target_invalid", "target is not mutable for this carrier kind");
  const normalizedFilter = filter === null ? null : String(filter).normalize("NFKC").toLowerCase();
  const matched = values.filter((item) => (!target || item.target === target) && (!normalizedFilter ||
    String(item.id).toLowerCase().includes(normalizedFilter)));
  const binding = { v: 1, digest: carrier.content_digest, wk: carrier.wk_id, focus: carrier.focus, kind: carrier.carrier_kind,
    target, filter: normalizedFilter };
  const offset = cursor === null ? 0 : decodeCursor(cursor, binding);
  if (offset > matched.length) fail("controlled_contract_query_cursor_invalid", "cursor exceeds the matching population");
  const counts = population({ values, carrierKind: carrier.carrier_kind });
  const result = { ...queryBase(carrier, "index"), target, filter: normalizedFilter, population_total: counts.total,
    population_by_target: counts.by_target, matched_total: matched.length, returned_count: 0, remaining_count: matched.length - offset,
    items: [], continuation: null };
  const spills = [];
  for (let index = offset; index < matched.length; index += 1) {
    const { target: itemTarget, id, selector } = matched[index]; result.items.push({ target: itemTarget, id, selector });
    result.returned_count += 1;
    result.remaining_count -= 1; result.continuation = result.remaining_count > 0 ? encodeCursor({ ...binding, offset: index + 1 }) : null;
    if (bytes(result) <= AUTHORING_LIMITS.index) continue;
    result.items.pop(); result.returned_count -= 1; result.remaining_count += 1;
    if (result.returned_count > 0) {
      result.continuation = encodeCursor({ ...binding, offset: index }); break;
    }
    result.items.push({ target: itemTarget, item_spilled: true });
    result.returned_count += 1; result.remaining_count -= 1;
    result.continuation = result.remaining_count > 0
      ? encodeCursor({ ...binding, offset: index + 1 }) : null;
    spills.push({ collection: "items", index: 0,
      value: { target: itemTarget, id, selector }, integrity_prefix: "item" });
    if (bytes(result) > AUTHORING_LIMITS.index) fail("controlled_contract_query_projection_too_large",
      "item-scoped carrier-index spill exceeds the bounded page limit");
    break;
  }
  PROJECTION_SPILLS.set(result, spills);
  return Object.freeze(result);
}
function selectedProjection(carrier, selectors) {
  if (!Array.isArray(selectors) || selectors.length === 0 || selectors.length > 64 ||
      selectors.some((value) => typeof value !== "string" || value.length === 0))
    fail("controlled_contract_query_selectors_invalid", "selectors must contain 1 to 64 stable identities");
  const all = controlledContractCarrierItems(carrier.content, carrier.carrier_kind);
  const bySelector = new Map(all.map((item) => [item.selector, item])); const matched = selectors.filter((selector) => bySelector.has(selector));
  const missing = selectors.filter((selector) => !bySelector.has(selector));
  const result = { ...queryBase(carrier, "selected"), requested_count: selectors.length, matched_count: matched.length,
    returned_count: 0, byte_omitted_matched_count: matched.length, missing_selector_count: missing.length,
    missing_selector_returned_count: 0, missing_selector_omitted_count: missing.length, items: [], missing_selectors: [] };
  const spills = [];
  for (const selector of matched) {
    const { target, id, value } = bySelector.get(selector); const inline = { target, id, selector, value }; result.items.push(inline);
    result.returned_count += 1; result.byte_omitted_matched_count -= 1;
    if (bytes(result) <= AUTHORING_LIMITS.selected) continue;
    result.items.pop();
    const spilled = { target, id, selector, value_spilled: true };
    result.items.push(spilled);
    if (bytes(result) <= AUTHORING_LIMITS.selected) continue;
    result.items.pop(); result.returned_count -= 1; result.byte_omitted_matched_count += 1;
    continue;
  }
  for (let index = 0; index < result.items.length; index += 1) {
    if (result.items[index].value_spilled !== true) continue;
    spills.push({ collection: "items", index,
      value: bySelector.get(result.items[index].selector).value, integrity_prefix: "node" });
  }
  for (const selector of missing) {
    result.missing_selectors.push(selector); result.missing_selector_returned_count += 1; result.missing_selector_omitted_count -= 1;
    if (bytes(result) <= AUTHORING_LIMITS.selected) continue;
    result.missing_selectors.pop(); result.missing_selector_returned_count -= 1; result.missing_selector_omitted_count += 1;
  }
  PROJECTION_SPILLS.set(result, spills);
  return Object.freeze(result);
}
export function projectControlledContractCarrierQuery({ carrier, selectors, target, filter, cursor }) {
  return selectors === undefined ? indexProjection(carrier, { target, filter, cursor }) : selectedProjection(carrier, selectors); }
export function getControlledContractProjectionSpills(result) { return PROJECTION_SPILLS.get(result) ?? []; }
export function getControlledContractNodeSpills(result) {
  return new Map(getControlledContractProjectionSpills(result)
    .filter(({ integrity_prefix: prefix }) => prefix === "node")
    .map(({ index, value }) => [result.items[index].selector, value]));
}
export function diffControlledContractCarrierContent({ before, after, carrierKind }) {
  const index = (content) => new Map(controlledContractCarrierItems(content, carrierKind).map((item) => [`${item.target}\0${item.id}`, item]));
  const prior = index(before); const next = index(after); const changed = {};
  for (const key of new Set([...prior.keys(), ...next.keys()])) {
    const left = prior.get(key); const right = next.get(key); if (JSON.stringify(left?.value) === JSON.stringify(right?.value)) continue;
    const { target, id } = right ?? left; (changed[target] ??= []).push(id);
  }
  for (const [target, ids] of Object.entries(changed)) changed[target] = [...new Set(ids)].sort(); return changed;
}
export function applyControlledContractCarrierPatch({ content, carrierKind, operations }) {
  const targets = CARRIER_TARGETS[carrierKind]; const requestBytes = Buffer.byteLength(JSON.stringify({ carrier_kind: carrierKind, operations }), "utf8");
  if (!targets || !Array.isArray(operations) || operations.length === 0 || operations.length > 64 || requestBytes > 65536)
    fail("controlled_contract_patch_request_too_large", "patch must contain 1 to 64 operations within 65,536 UTF-8 bytes", { byte_length: requestBytes });
  const next = structuredClone(content); const removed = new Map();
  for (const operation of operations) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation) || Buffer.byteLength(JSON.stringify(operation), "utf8") > 16384)
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
    next[operation.target] ??= []; const idOf = (value) => carrierValueId(operation.target, rule, value);
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
  return Object.freeze({ content: next });
}
function schemaShape(schema, root, depth = 0) {
  if (!schema || depth > 16) return {};
  if (schema.$ref) return schemaShape(root.$defs?.[schema.$ref.split("/").at(-1)], root, depth + 1);
  const keys = ["type", "const", "enum", "required", "additionalProperties", "minItems",
    "maxItems", "minLength", "maxLength", "minimum", "maximum", "pattern"];
  const result = Object.fromEntries(keys.filter((key) => schema[key] !== undefined).map((key) => [key, structuredClone(schema[key])]));
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) =>
    [key, schemaShape(value, root, depth + 1)]));
  if (schema.items) result.items = schemaShape(schema.items, root, depth + 1); if (schema.anyOf) {
    for (const key of ["operator", "applicability_context", "operands"]) delete result.properties?.[key];
    result.variants = schema.anyOf.map((value) => ({ operators: value.properties?.operator?.enum ?? [],
      applicability_modes: value.properties?.applicability_context?.properties?.mode?.enum ?? [],
      operands: schemaShape(value.properties?.operands, root, depth + 1) }));
  }
  for (const key of ["oneOf", "allOf"]) if (schema[key]) result[key] = schema[key].map((value) => schemaShape(value, root, depth + 1));
  return result;
}
function minimal(schema, root, depth = 0) {
  if (!schema || depth > 16) return null;
  if (schema.$ref) return minimal({ ...root.$defs?.[schema.$ref.split("/").at(-1)], ...schema, $ref: undefined }, root, depth + 1);
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (schema.enum) return structuredClone(schema.enum[0]);
  if (schema.oneOf) return minimal(schema.oneOf[0], root, depth + 1);
  const branch = schema.anyOf?.[0]; if (branch) return minimal({ ...schema, ...branch, properties: Object.fromEntries([...new Set([
    ...Object.keys(schema.properties ?? {}), ...Object.keys(branch.properties ?? {})])].map((key) => [key,
    { ...schema.properties?.[key], ...branch.properties?.[key] }])), anyOf: undefined }, root, depth + 1);
  if (schema.allOf) return minimal(schema.allOf.reduce((result, value) => ({ ...result, ...value,
    properties: { ...result.properties, ...value.properties }, required: [...new Set([...(result.required ?? []),
      ...(value.required ?? [])])] }), { ...schema, allOf: undefined }), root, depth + 1);
  if (schema.type === "array") return Array.from({ length: schema.minItems ?? 0 }, () => minimal(schema.items, root, depth + 1));
  if (schema.type === "object" || schema.properties) return Object.fromEntries((schema.required ?? []).map((key) =>
    [key, minimal(schema.properties?.[key], root, depth + 1)]));
  if (schema.type === "boolean") return false;
  if (["integer", "number"].includes(schema.type)) return schema.minimum ?? 0;
  const prefix = [["^ref-", "ref"], ["^prop-", "prop"], ["^claim-", "claim"], ["^rel-", "rel"], ["^set-", "set"],
    ["^res-", "res"], ["^ann-", "ann"]].find(([pattern]) => schema.pattern?.startsWith(pattern));
  if (prefix) return `${prefix[1]}-example`;
  if (schema.pattern?.includes("[0-9]+\\.[0-9]+\\.[0-9]+")) return "1.0.0";
  if (schema.pattern?.includes("(?:[._-][a-z0-9]+)+")) return "example.value";
  return "example";
}
export function describeControlledContractAuthoring({ carrierKind, target = null, schemas }) {
  const targets = CARRIER_TARGETS[carrierKind]; if (!targets) fail("controlled_contract_authoring_kind_invalid", "carrier kind has no authoring schema");
  const base = { schema_version: "controlled-contract-authoring-description.v1", carrier_kind: carrierKind,
    immutable_fields: IMMUTABLE_CARRIER_FIELDS[carrierKind], targets: Object.entries(targets).map(([name, identity_rule]) =>
      ({ target: name, identity_rule, mutable: true })), authority: "package_backed_non_authoritative" };
  if (target === null) { if (bytes(base) > AUTHORING_LIMITS.index) fail("controlled_contract_authoring_projection_too_large", "compact authoring description exceeds 4,096 bytes"); return base; }
  if (!Object.hasOwn(targets, target)) fail("controlled_contract_authoring_target_invalid", "target is not mutable for this carrier kind");
  const root = schemas[carrierKind]; const source = root.properties[target];
  const resolvedSource = source?.$ref ? root.$defs?.[source.$ref.split("/").at(-1)] : source; const itemSchema = resolvedSource?.items ?? resolvedSource;
  const result = { ...base, selected_target: target,
    schema_fragment: schemaShape(itemSchema, root), minimal_valid_template: minimal(itemSchema, root) };
  if (carrierKind === "proof_plan_request" && target === "selected_packs") {
    result.server_derived_fields = [{ field: "evaluation_input_path",
      derivation: "canonical evaluation-input carrier basename from wk_id and optional focus",
      caller_authored: false }];
  }
  if (bytes(result) > AUTHORING_LIMITS.selected) fail("controlled_contract_authoring_projection_too_large", "target authoring description exceeds 16,384 bytes", { target });
  return result;
}
function identity(value, index) { return value?.pattern_id ?? value?.role ?? value?.intent_id ?? value?.input_id ?? value?.claim_id ?? value?.reference_id ?? String(index); }
function detailEntries(source, selectedSections) {
  return selectedSections.flatMap((section) => {
    const value = source[section]; if (Array.isArray(value)) return value.map((entry, index) =>
      ({ section, selector: identity(entry, index), value: entry }));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([group, entry]) => Array.isArray(entry)
      ? entry.map((item, index) => ({ section, group, selector: identity(item, index), value: item }))
      : [{ section, selector: group, value: entry }]);
    return value === undefined ? [] : [{ section, selector: section, value }];
  });
}
function detailPage(base, source, { sections = [], selectors = [], cursor = null, cursorBinding = selectors }, bindingDigest) {
  sections ??= []; selectors ??= [];
  const available = Object.keys(source); const selectedSections = sections.length ? sections : available;
  if (selectedSections.some((section) => !available.includes(section))) fail("controlled_contract_detail_section_invalid", "unknown detail section");
  let entries = detailEntries(source, selectedSections); if (selectors.length) entries = entries.filter(({ selector }) => selectors.includes(selector));
  const binding = { v: 1, digest: bindingDigest, sections: selectedSections.join("\0"), selectors: cursorBinding.join("\0") };
  const offset = cursor === null ? 0 : decodeCursor(cursor, binding); const result = { ...base, detail: true,
    detail_total: entries.length, returned_count: 0, remaining_count: entries.length - offset,
    entries: [], continuation: null };
  const spills = [];
  for (let index = offset; index < entries.length; index += 1) {
    result.entries.push(entries[index]); result.returned_count += 1; result.remaining_count -= 1;
    result.continuation = result.remaining_count ? encodeCursor({ ...binding, offset: index + 1 }) : null;
    if (bytes(result) <= AUTHORING_LIMITS.selected) continue;
    result.entries.pop(); result.returned_count -= 1; result.remaining_count += 1;
    if (result.returned_count > 0) {
      result.continuation = encodeCursor({ ...binding, offset: index }); break;
    }
    result.entries.push({ section: entries[index].section, entry_spilled: true });
    result.returned_count += 1; result.remaining_count -= 1;
    result.continuation = result.remaining_count
      ? encodeCursor({ ...binding, offset: index + 1 }) : null;
    spills.push({ collection: "entries", index: 0, value: entries[index], integrity_prefix: "entry" });
    if (bytes(result) > AUTHORING_LIMITS.selected) fail("controlled_contract_detail_projection_too_large",
      "item-scoped proof detail spill exceeds the bounded page limit");
    break;
  }
  PROJECTION_SPILLS.set(result, spills);
  return result;
}
export function compactProofPackDescription(full, options = {}) {
  const base = { schema_version: "controlled-contract-proof-pack-description.v2", profile_id: full.profile_id,
    profile_version: full.profile_version, requested_intents: full.requested_intents, intent_definitions: full.intent_definitions,
    intent_distinctions: full.intent_distinctions, guarantee: full.guarantee, explicit_exclusions: full.explicit_exclusions,
    stages: full.evaluation_input_skeleton?.allowed_evaluation_stages ?? [], counts: full.counts, source_digests: full.source_digests,
    projection_digest: full.projection_digest, authority: full.authority,
    detail_sections: ["compatibility", "evaluation_input_skeleton", "role_constraints", "proof_obligations"] };
  const targeted = options.sections?.length || options.selectors?.length || options.cursor; if (!targeted) {
    if (bytes(base) > AUTHORING_LIMITS.index) fail("proof_pack_description_too_large", "compact proof-pack description exceeds 4,096 bytes"); return base; }
  return detailPage(base, full, options, full.projection_digest);
}
export function bindingInspectionCursorPosition(cursor) {
  if (cursor === null || cursor === undefined) return 0;
  let value; try { value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
  catch { fail("controlled_contract_query_cursor_invalid", "continuation cursor is malformed"); }
  if (!Number.isSafeInteger(value?.offset) || value.offset < 0)
    fail("controlled_contract_query_cursor_invalid", "continuation cursor offset is invalid");
  return value.offset;
}
export function compactBindingInspection(page, options = {}) {
  const prefix = options.prefix ?? {}; const roles = options.roles ?? [];
  const statuses = options.statuses ?? []; const targeted = roles.length || statuses.length || options.cursor;
  const binding = { v: 2, ...options.cursorBinding,
    contract: page.digests.contract, evaluation: page.digests.evaluation_input,
    profile: `${page.profile_id}@${page.profile_version}`,
    intents: page.requested_intents.join("\0"), roles: page.selection.roles.join("\0"),
    statuses: page.selection.statuses.join("\0"), result: page.digests.result };
  const offset = options.cursor ? decodeCursor(options.cursor, binding) : 0;
  if (offset !== page.population.offset)
    fail("controlled_contract_query_cursor_mismatch", "binding page offset does not match its cursor");
  const base = { schema_version: "controlled-contract-binding-inspection.v3",
    profile_id: page.profile_id, profile_version: page.profile_version,
    authority: page.authority, status: page.summary.status, counts: page.counts,
    digests: { contract: page.digests.contract, evaluation_input: page.digests.evaluation_input,
      result: page.digests.result, profile: page.digests.profile } };
  if (!targeted) {
    const result = { ...base, diagnostic_total: page.evaluation_input_diagnostics.length,
      diagnostic_returned: 0, diagnostic_omitted: page.evaluation_input_diagnostics.length,
      diagnostics: [], role_index_total: page.role_index.length, role_index_returned: 0,
      role_index_omitted: page.role_index.length, role_index: [],
      population_total: page.population.total_count,
      continuation: page.population.total_count ? encodeCursor({ ...binding, offset: 0 }) : null };
    for (const entry of page.evaluation_input_diagnostics) {
      result.diagnostics.push(entry); result.diagnostic_returned += 1; result.diagnostic_omitted -= 1;
      if (bytes({ ...prefix, ...result }) <= AUTHORING_LIMITS.index) continue;
      result.diagnostics.pop(); result.diagnostic_returned -= 1; result.diagnostic_omitted += 1; break;
    }
    for (const entry of page.role_index) {
      result.role_index.push(entry); result.role_index_returned += 1; result.role_index_omitted -= 1;
      if (bytes({ ...prefix, ...result }) <= AUTHORING_LIMITS.index) continue;
      result.role_index.pop(); result.role_index_returned -= 1; result.role_index_omitted += 1; break;
    }
    if (bytes({ ...prefix, ...result }) > AUTHORING_LIMITS.index)
      fail("proof_pack_binding_summary_too_large", "compact binding summary exceeds 4,096 bytes");
    return result;
  }
  const result = { ...base, selection: page.selection,
    total_count: page.population.total_count, matched_count: page.population.matched_count,
    position: offset, returned_count: 0, omitted_count: page.population.total_count,
    remaining_count: page.population.total_count - offset, entries: [], continuation: null };
  const spills = [];
  for (let index = 0; index < page.items.length; index += 1) {
    const entry = page.items[index]; result.entries.push(entry); result.returned_count += 1;
    result.omitted_count -= 1; result.remaining_count -= 1;
    const next = offset + index + 1;
    result.continuation = result.remaining_count ? encodeCursor({ ...binding, offset: next }) : null;
    if (bytes({ ...prefix, ...result }) <= AUTHORING_LIMITS.selected) continue;
    result.entries.pop(); result.returned_count -= 1; result.omitted_count += 1; result.remaining_count += 1;
    if (result.returned_count > 0) { result.continuation = encodeCursor({ ...binding, offset: next - 1 }); break; }
    result.entries.push({ kind: entry.kind, role: entry.role, item_spilled: true });
    result.returned_count = 1; result.omitted_count -= 1; result.remaining_count -= 1;
    result.continuation = result.remaining_count ? encodeCursor({ ...binding, offset: next }) : null;
    spills.push({ collection: "entries", index: 0, value: entry, integrity_prefix: "item" });
    if (bytes({ ...prefix, ...result, spill_metadata_reserve: "x".repeat(1024) }) > AUTHORING_LIMITS.selected)
      fail("proof_pack_binding_projection_too_large", "item-scoped binding spill exceeds the bounded page limit");
    break;
  }
  PROJECTION_SPILLS.set(result, spills); return result;
}

import { decodeCursor, encodeCursor } from "./controlled-contract-authoring-projections.mjs";

export const FROZEN_REVIEW_CONTRACT_QUERY_SCHEMA_VERSION = "frozen-review-contract-query.v1";
export const FROZEN_REVIEW_CONTRACT_QUERY_REFUSAL_SCHEMA_VERSION = "frozen-review-contract-query-refusal.v1";
export const FROZEN_REVIEW_CONTRACT_QUERY_LIMITS = Object.freeze({ index: 4096, page: 16384 });
export const FROZEN_REVIEW_CONTRACT_ARTIFACT_PATH_ENV_VAR =
  "WIKI_MCP_FROZEN_REVIEW_CONTRACT_PATH";
export const FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX =
  "frozen-review-contract-sha256-";
const TARGETS = new Set(["acceptance_criteria", "acceptance_validation"]);
const REQUEST_KEYS = new Set(["target", "cursor"]);
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

function refusal(reason_code, details = {}) {
  return Object.freeze({
    schema_version: FROZEN_REVIEW_CONTRACT_QUERY_REFUSAL_SCHEMA_VERSION, status: "refused",
    code: "frozen_review_contract_query_refused", severity: "blocking", reason_code,
    message: `frozen review contract query refused: ${reason_code}`,
    payload: { schema_version: FROZEN_REVIEW_CONTRACT_QUERY_REFUSAL_SCHEMA_VERSION,
      reason_code, ...details }
  });
}
function acceptance(contract, target) {
  const canonicalField = target === "acceptance_criteria" ? "criteria" : "validation";
  const value = contract?.acceptance?.[canonicalField] ??
    contract?.acceptance?.[target] ?? contract?.[canonicalField] ?? contract?.[target];
  return Array.isArray(value) ? value : null;
}
function sourceItems(artifact, target) {
  const parent = artifact?.canonical_parent_wk_contract ?? artifact?.parent ?? artifact;
  const selected = artifact?.review_unit_contract ?? artifact?.selected_unit ?? artifact?.unit;
  const parentValues = acceptance(parent, target); const selectedValues = acceptance(selected, target);
  if (!parentValues || !selectedValues) return null;
  return [
    ...parentValues.map((value, index) => ({ source: "parent", index, value })),
    ...selectedValues.map((value, index) => ({ source: "selected_unit", index, value }))
  ];
}
function digestOf(artifact) { return artifact?.artifact_digest ?? artifact?.content_digest ?? artifact?.digest; }
function requestShape(request) {
  return Boolean(request && typeof request === "object" && !Array.isArray(request)) &&
    Object.keys(request).every((key) => REQUEST_KEYS.has(key));
}
function boundedIndex(digest, target, items) {
  const counts = Object.fromEntries([...TARGETS].map((name) => [name,
    target === null ? items.filter((item) => item.target === name).length : name === target ? items.length : 0]));
  const result = { schema_version: FROZEN_REVIEW_CONTRACT_QUERY_SCHEMA_VERSION,
    projection: "index", artifact_digest: digest, target, total: items.length, returned: 0,
    omitted: items.length, counts, next_cursor: items.length === 0 ? null : encodeCursor({
      v: 1, digest, target: target ?? "acceptance_criteria", offset: 0 }) };
  return bytes(result) <= FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.index ? Object.freeze(result) : refusal("index_oversized");
}

export function queryFrozenReviewContract({ artifact, request = {} } = {}) {
  if (!requestShape(request)) return refusal("request_shape_invalid");
  const digest = digestOf(artifact);
  if (typeof digest !== "string" || digest.length === 0) return refusal("artifact_digest_missing");
  if (!artifact || artifact.status === "refused" || artifact.readable === false) return refusal("artifact_unreadable");
  const target = request.target === undefined ? null : request.target;
  if (target !== null && !TARGETS.has(target)) return refusal("target_invalid");
  if (request.cursor !== undefined && (typeof request.cursor !== "string" || request.cursor.length === 0))
    return refusal("cursor_malformed");
  if (target === null && request.cursor !== undefined) return refusal("cursor_target_missing");
  const targets = target === null ? [...TARGETS] : [target];
  const allItems = [];
  for (const name of targets) {
    const values = sourceItems(artifact, name);
    if (!values) return refusal("acceptance_missing");
    allItems.push(...values.map((item) => ({ ...item, target: name })));
  }
  if (target === null && request.cursor === undefined) return boundedIndex(digest, target, allItems);
  const binding = { v: 1, digest, target }; let offset = 0;
  if (request.cursor !== undefined) {
    try { offset = decodeCursor(request.cursor, binding); } catch { return refusal("cursor_mismatched_or_malformed"); }
  }
  if (offset > allItems.length) return refusal("cursor_stale");
  const pageItems = [];
  for (let nextOffset = offset; nextOffset < allItems.length; nextOffset += 1) {
    const item = allItems[nextOffset];
    const candidate = { source: item.source, source_index: item.index, value: item.value };
    const candidateItems = [...pageItems, candidate];
    const omitted = allItems.length - offset - candidateItems.length;
    const probe = { schema_version: FROZEN_REVIEW_CONTRACT_QUERY_SCHEMA_VERSION, projection: "page",
      artifact_digest: digest, target, total: allItems.length, returned: candidateItems.length,
      omitted, items: candidateItems, next_cursor: omitted === 0 ? null : encodeCursor({ ...binding,
        offset: offset + candidateItems.length }) };
    if (bytes(probe) > FROZEN_REVIEW_CONTRACT_QUERY_LIMITS.page) break;
    pageItems.push(candidate);
  }
  if (pageItems.length === 0 && offset < allItems.length) {
    const item = allItems[offset];
    const projected = { source: item.source, source_index: item.index, value: item.value };
    return refusal("page_oversized", {
      target_offset: offset,
      item_utf8_bytes: bytes(projected)
    });
  }
  const omitted = allItems.length - offset - pageItems.length;
  const result = { schema_version: FROZEN_REVIEW_CONTRACT_QUERY_SCHEMA_VERSION, projection: "page",
    artifact_digest: digest, target, total: allItems.length, returned: pageItems.length, omitted,
    items: pageItems, next_cursor: omitted === 0 ? null : encodeCursor({ ...binding,
      offset: offset + pageItems.length }) };
  return Object.freeze(result);
}



const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export const AUTHORED_REQUIREMENT_DIAGNOSTIC_CODES = Object.freeze({
  DUPLICATE_ROW: "authored_requirement_row_duplicate",
  CLAIM_UNKNOWN: "authored_requirement_row_claim_unknown",
  CLAIM_NOT_A_REQUIREMENT: "authored_requirement_row_claim_not_a_requirement",
  INCOMPLETE_ROW_EMITS: "authored_requirement_incomplete_row_emits",
  MEMBERSHIP_ROW_CLAIMS: "authored_requirement_membership_row_claims",
  DEFINITION_ROW_CLAIMS: "authored_requirement_definition_row_claims",
  COMPLETE_ROW_EMITS_NOTHING: "authored_requirement_complete_row_emits_nothing",
  SOURCE_LOCATION_INVALID: "authored_requirement_source_location_invalid",
  DUPLICATE_COLLECTION: "authored_requirement_collection_duplicate",
  COLLECTION_MEMBER_UNKNOWN: "authored_requirement_collection_member_unknown"
});
const CODES = AUTHORED_REQUIREMENT_DIAGNOSTIC_CODES;

export function hasAuthoredRequirements(contract) {
  const authored = contract?.authored_requirements;
  return authored !== undefined && authored !== null &&
    (authored.rows.length > 0 || authored.collections.length > 0 || authored.unresolved.length > 0);
}

export function authoredRequirementDiagnostics(contract) {
  const authored = contract?.authored_requirements;
  if (authored === undefined || authored === null) return [];
  const diagnostics = [];
  const claims = new Map(contract.claims.map(claim => [claim.claim_id, claim]));
  const rows = new Set();
  for (const row of authored.rows) {
    const about = { row_id: row.row_id };
    if (rows.has(row.row_id)) diagnostics.push({ code: CODES.DUPLICATE_ROW, ...about });
    rows.add(row.row_id);
    const membership = Object.hasOwn(row.input, "membership");
    const definition = row.input.definition === true;
    const complete = row.pending.length === 0;
    for (const claimId of row.claim_ids) {
      const claim = claims.get(claimId);
      if (claim === undefined) diagnostics.push({ code: CODES.CLAIM_UNKNOWN, ...about, claim_id: claimId });
      else if (claim.kind === "verification") diagnostics.push({ code: CODES.CLAIM_NOT_A_REQUIREMENT, ...about, claim_id: claimId });
    }
    if (!complete && (row.constraint_ids.length > 0 || row.claim_ids.length > 0)) diagnostics.push({
      code: CODES.INCOMPLETE_ROW_EMITS, ...about, pending_count: row.pending.length });
    if (membership && row.claim_ids.length > 0) diagnostics.push({ code: CODES.MEMBERSHIP_ROW_CLAIMS, ...about });
    if (definition && row.claim_ids.length > 0) diagnostics.push({ code: CODES.DEFINITION_ROW_CLAIMS, ...about });
    if (complete && (row.constraint_ids.length === 0 || (!membership && !definition && row.claim_ids.length !== row.constraint_ids.length))) {
      diagnostics.push({ code: CODES.COMPLETE_ROW_EMITS_NOTHING, ...about,
        constraint_count: row.constraint_ids.length, claim_count: row.claim_ids.length });
    }
    if (row.source !== undefined) {
      const { start, end } = row.source.location;
      if (end - start !== row.source.user_requirement.length) diagnostics.push({ code: CODES.SOURCE_LOCATION_INVALID, ...about,
        start, end, passage_length: row.source.user_requirement.length });
    }
  }
  const collections = new Set();
  for (const collection of authored.collections) {
    const about = { collection_row_id: collection.collection_row_id };
    if (collections.has(collection.collection_row_id)) diagnostics.push({ code: CODES.DUPLICATE_COLLECTION, ...about });
    collections.add(collection.collection_row_id);
    for (const rowId of collection.member_row_ids) {
      if (!rows.has(rowId)) diagnostics.push({ code: CODES.COLLECTION_MEMBER_UNKNOWN, ...about, row_id: rowId });
    }
  }
  return diagnostics.sort((left, right) => compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(JSON.stringify(left), JSON.stringify(right)));
}

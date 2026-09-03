import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  collectWorkRecordControlledContractPrivateScopeFacts
} from "../../lib/controlled-contract-private-path-policy.mjs";
import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import {
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS,
  assertControlledContractSemanticProjectionBound,
  controlledContractPrettyJsonBytes
} from "./semantic-projection-bounds.mjs";

const TERMINAL = new Set(["done", "cancelled"]);
const CURSOR_KEY = randomBytes(32);

function compare(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonical(value[key])])
  );
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function encodeCursor(payload) {
  const encoded = Buffer.from(JSON.stringify(canonical(payload))).toString("base64url");
  const signature = createHmac("sha256", CURSOR_KEY).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeCursor(cursor, censusDigest) {
  try {
    const [encoded, signature, extra] = String(cursor).split(".");
    if (!encoded || !signature || extra !== undefined) throw new Error("shape");
    const expected = createHmac("sha256", CURSOR_KEY).update(encoded).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error("signature");
    }
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (value.family !== "private_scope_census" || value.census_digest !== censusDigest ||
        !Number.isInteger(value.ordinal) || value.ordinal < 0 ||
        value.maximum_bytes !== CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes ||
        value.maximum_items !== CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items) {
      throw new Error("binding");
    }
    return value.ordinal;
  } catch {
    throw new ControlledContractToolError(
      "controlled_contract_private_scope_census_cursor_invalid",
      "private-scope census cursor authentication or source binding failed",
      { changed: false, caller_correctable: true }
    );
  }
}

function factIsTerminal(fact) {
  return TERMINAL.has(fact.status) || TERMINAL.has(fact.parent_status);
}

function disposition(fact) {
  if (factIsTerminal(fact)) return "already_terminal";
  if (fact.match_kind === "exact" ||
      (fact.match_kind === "directory" && fact.normalized_entry !== fact.private_root)) {
    return "safe_exact_removal";
  }
  return "manual_scope_rewrite_required";
}

async function loadCensusRows(repoRoot) {
  const directory = path.join(path.resolve(repoRoot), "wiki", "work-records");
  const names = (await readdir(directory)).filter((name) => /^WK-[0-9]{4}\.json$/u.test(name))
    .sort(compare);
  const records = [];
  for (const name of names) records.push(JSON.parse(await readFile(path.join(directory, name), "utf8")));
  const allFacts = records.flatMap((record) => collectWorkRecordControlledContractPrivateScopeFacts(record));
  const nonterminal = allFacts.filter((fact) => !factIsTerminal(fact));
  const items = nonterminal.map((fact) => Object.freeze({
    unit_address: fact.unit_address,
    status: fact.status,
    parent_status: fact.parent_status,
    field: fact.field,
    entry: fact.entry,
    normalized_entry: fact.normalized_entry,
    match_kind: fact.match_kind,
    disposition_class: disposition(fact),
    policy_authority: fact.policy_authority,
    local_refusal_authority: false
  })).sort((left, right) => compare(left.unit_address, right.unit_address) ||
    compare(left.field, right.field) || compare(left.normalized_entry, right.normalized_entry));
  const sourceIdentity = Object.freeze({
    record_count: records.length,
    record_population_digest: digest(records.map((record) => ({
      id: record.id,
      status: record.status,
      source_digest: digest(record)
    })))
  });
  return { records, allFacts, items, sourceIdentity };
}

export async function queryControlledContractPrivateScopeCensusOperation({
  repoRoot,
  cursor = null
}) {
  const { records, allFacts, items, sourceIdentity } = await loadCensusRows(repoRoot);
  const censusDigest = digest({ sourceIdentity, items });
  const ordinal = cursor === null || cursor === undefined
    ? 0 : decodeCursor(cursor, censusDigest);
  const statuses = new Map();
  const fields = new Map();
  const matchKinds = new Map();
  for (const row of allFacts) {
    statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
    fields.set(row.field, (fields.get(row.field) ?? 0) + 1);
    matchKinds.set(row.match_kind, (matchKinds.get(row.match_kind) ?? 0) + 1);
  }
  const page = {
    schema_version: "controlled-contract-private-scope-census.v1",
    source_identity: sourceIdentity,
    census_digest: censusDigest,
    counts: Object.freeze({
      records: records.length,
      units_with_intersections: new Set(allFacts.map((row) => row.unit_address)).size,
      nonterminal_units_with_intersections: new Set(items.map((row) => row.unit_address)).size,
      intersections: allFacts.length,
      nonterminal_intersections: items.length,
      terminal_intersections: allFacts.length - items.length,
      by_status: Object.freeze(Object.fromEntries([...statuses].sort(([a], [b]) => compare(a, b)))),
      by_field: Object.freeze(Object.fromEntries([...fields].sort(([a], [b]) => compare(a, b)))),
      by_match_kind: Object.freeze(Object.fromEntries([...matchKinds].sort(([a], [b]) => compare(a, b))))
    }),
    matched_count: items.length,
    returned_count: 0,
    omitted_count: Math.max(0, items.length - ordinal),
    items: [],
    has_more: false,
    cursor: null,
    byte_limit: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes,
    item_limit: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items,
    read_only: true,
    mutation_count: 0,
    local_refusal_authority: false
  };
  for (const item of items.slice(
    ordinal, ordinal + CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items
  )) {
    page.items.push(item);
    page.returned_count += 1;
    page.omitted_count -= 1;
    page.has_more = ordinal + page.returned_count < items.length;
    page.cursor = page.has_more ? encodeCursor({
      family: "private_scope_census",
      census_digest: censusDigest,
      ordinal: ordinal + page.returned_count,
      maximum_bytes: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes,
      maximum_items: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items
    }) : null;
    if (controlledContractPrettyJsonBytes(page) <=
        CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes) continue;
    page.items.pop();
    page.returned_count -= 1;
    page.omitted_count += 1;
    page.has_more = ordinal + page.returned_count < items.length;
    page.cursor = page.has_more ? encodeCursor({
      family: "private_scope_census", census_digest: censusDigest,
      ordinal: ordinal + page.returned_count,
      maximum_bytes: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes,
      maximum_items: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items
    }) : null;
    break;
  }
  if (page.returned_count === 0 && ordinal < items.length) throw new ControlledContractToolError(
    "controlled_contract_semantic_projection_invalid",
    "one private-scope census item cannot fit the declared page bound",
    { changed: false, ordinal }
  );
  return Object.freeze(assertControlledContractSemanticProjectionBound(
    page,
    CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes,
    { projection_class: "private_scope_census" }
  ));
}

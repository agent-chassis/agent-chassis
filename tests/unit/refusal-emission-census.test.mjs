

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isRuntimeBlockerCode,
  getRuntimeBlockerEntry
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CENSUS_PATH = path.join(
  REPO_ROOT,
  "packages/wiki-core/data/refusal-emission-census.v1.json"
);

const census = JSON.parse(readFileSync(CENSUS_PATH, "utf8"));

const SEMANTIC_CATEGORIES = [
  "authenticity",
  "integrity",
  "identity",
  "confinement",
  "transaction_safety",
  "replay",
  "exact_returned_policy"
];

test("the census declares its schema, owner, and entry count", () => {
  assert.equal(census.schema_version, "refusal-emission-census.v1");
  assert.equal(census.owner, "WK-2359");
  assert.equal(typeof census.description, "string");
  assert.ok(Array.isArray(census.entries));
  assert.equal(census.entry_count, census.entries.length,
    "the declared entry_count must match the actual population");
});

test("the census declares the closed semantic category vocabulary", () => {
  assert.deepEqual(census.semantic_categories.slice().sort(), SEMANTIC_CATEGORIES.slice().sort());
});

test("the census records its source-population provenance", () => {
  const p = census.provenance;
  assert.ok(p, "the census must carry provenance");

  assert.match(p.base_identity, /^[0-9a-f]{40}$/, "base_identity must be a git commit sha");
  assert.equal(p.base_kind, "git_commit");
  assert.equal(typeof p.audit_method, "string");
  assert.ok(p.audit_method.length > 40, "the audit method must be described, not named");
  assert.equal(typeof p.declared_population, "string");
  assert.ok(Array.isArray(p.audited_source_files) && p.audited_source_files.length > 0);
});

test("the census disclaims repository-wide authority and names the owner that has it", () => {

  const p = census.provenance;
  assert.ok(p.not_claimed.includes("repository-wide completeness"));
  assert.ok(p.not_claimed.includes("discovery of new emission sites"));
  assert.ok(p.not_claimed.includes("source moves") || p.not_claimed.includes("detection of source moves"));
  assert.ok(p.not_claimed.includes("drift gating"));
  assert.equal(p.population_owner_for_repository_scope, "WK-2361");
});

test("the census discloses its omissions rather than hiding them", () => {
  assert.ok(Array.isArray(census.disclosed_omissions),
    "an omission list must exist even when it is empty");
  for (const omission of census.disclosed_omissions) {
    assert.equal(typeof omission.source_id, "string");
    assert.ok(omission.reason.length > 0, "every omission must state why it was omitted");
  }
});

test("every supplied source identity is unique", () => {
  const seen = new Set();
  for (const entry of census.entries) {
    assert.equal(seen.has(entry.source_id), false,
      `duplicate source identity ${entry.source_id}`);
    seen.add(entry.source_id);
  }
  assert.equal(seen.size, census.entries.length);
});

test("every entry is assigned EXACTLY ONE semantic category", () => {
  for (const entry of census.entries) {
    assert.ok(
      SEMANTIC_CATEGORIES.includes(entry.semantic_category),
      `${entry.source_id} declares unknown semantic category ${entry.semantic_category}`
    );

    assert.equal(typeof entry.semantic_category, "string");
    assert.equal(Array.isArray(entry.semantic_category), false);
  }
});

test("every entry names the failed operation and the unsafe continuation effect", () => {
  for (const entry of census.entries) {
    assert.ok(
      typeof entry.failed_operation === "string" && entry.failed_operation.length > 0,
      `${entry.source_id} must name the operation that would have failed`
    );
    assert.ok(
      typeof entry.unsafe_continuation_effect === "string" &&
        entry.unsafe_continuation_effect.length > 0,
      `${entry.source_id} must state what continuing would have done unsafely`
    );
  }
});

test("DEC-0177: no procedure-only rule is registered in the mechanical taxonomy", () => {

  for (const entry of census.entries) {
    assert.equal(entry.procedure_only, false,
      `${entry.source_id} is procedure-only and must not be a mechanical emission`);
  }
});

test("every emitted code is registered in the canonical taxonomy", () => {
  for (const entry of census.entries) {
    assert.equal(
      isRuntimeBlockerCode(entry.emitted_code),
      true,
      `${entry.source_id} emits unregistered code ${entry.emitted_code}`
    );
  }
});

test("each entry's recorded registry category matches the canonical registry", () => {

  for (const entry of census.entries) {
    const registered = getRuntimeBlockerEntry(entry.emitted_code);
    assert.equal(entry.registry_category, registered.category,
      `${entry.source_id} records a stale registry category`);
  }
});

test("operator_recovery_needed census entries are external-only break-glass emissions", () => {
  const entries = census.entries.filter(
    (entry) => entry.emitted_code === "operator_recovery_needed"
  );
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const statement = `${entry.failed_operation} ${entry.unsafe_continuation_effect}`;
    assert.match(statement, /authenticated/i, entry.source_id);
    assert.match(statement, /unexpected condition/i, entry.source_id);
    assert.match(statement, /outside (?:the )?(?:tooling model|every modeled tooling route)/i, entry.source_id);
    assert.doesNotMatch(
      statement,
      /validation|malformed|unknown version|missing route|backend refusal|projection mismatch/i,
      entry.source_id
    );
  }
});

test("exact_returned_policy is used only for a transported policy decision", () => {

  const policyEntries = census.entries.filter(
    (entry) => entry.semantic_category === "exact_returned_policy"
  );
  for (const entry of policyEntries) {
    assert.match(
      entry.unsafe_continuation_effect,
      /policy|decision/i,
      `${entry.source_id} claims the policy limb without describing a returned decision`
    );
  }
});

test("each audited source file appears in the entry population or is disclosed", () => {

  const contributing = new Set(census.entries.map((entry) => entry.source_file));

  for (const file of contributing) {
    assert.ok(
      census.provenance.audited_source_files.includes(file),
      `${file} contributes entries but is not in the declared audited population`
    );
  }
});

test("WK-2359 does not gate repository drift from this corpus", () => {

  assert.equal(census.provenance.population_owner_for_repository_scope, "WK-2361");
  assert.ok(
    census.description.includes("Procedure-only") ||
      census.description.includes("procedure-only"),
    "the corpus must state the DEC-0177 exclusion it applies"
  );
});

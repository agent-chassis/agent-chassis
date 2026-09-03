

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CENSUS_PATH = path.join(
  REPO_ROOT,
  "packages/wiki-core/data/exception-disposition-census.v1.json"
);

const census = JSON.parse(readFileSync(CENSUS_PATH, "utf8"));

const LOCAL_TYPED = "local_typed_domain_translated";
const REGISTERED = "registered_public_refusal";
const SUPPRESSION = "proven_safe_suppression";
const DEFECT = "confirmed_public_translation_defect";
const EXTERNAL = "externally_owned_reference";

const DISPOSITIONS = [LOCAL_TYPED, REGISTERED, SUPPRESSION, DEFECT, EXTERNAL];

test("the corpus declares its schema, owner, dispositions, and entry count", () => {
  assert.equal(census.schema_version, "exception-disposition-census.v1");
  assert.equal(census.owner, "WK-2359");
  assert.deepEqual(census.dispositions.slice().sort(), DISPOSITIONS.slice().sort());
  assert.equal(census.entry_count, census.entries.length);
  assert.ok(census.entries.length > 0);
});

test("the corpus records its source-population provenance", () => {
  const p = census.provenance;
  assert.match(p.base_identity, /^[0-9a-f]{40}$/);
  assert.equal(p.base_kind, "git_commit");
  assert.ok(p.audit_method.length > 40);
  assert.equal(typeof p.declared_population, "string");
  assert.ok(Array.isArray(p.audited_source_files) && p.audited_source_files.length > 0);
});

test("the corpus disclaims discovery authority and names the owners that hold it", () => {
  const p = census.provenance;
  assert.ok(p.not_claimed.includes("repository-wide completeness"));
  assert.ok(p.not_claimed.includes("discovery of new sites"));
  assert.ok(p.not_claimed.includes("detection of source moves"));
  assert.ok(p.not_claimed.includes("drift gating"));
  assert.equal(p.population_owner_for_repository_scope, "WK-2361");
  assert.equal(p.async_and_process_guard_owner, "WK-2382");
});

test("the corpus discloses its omissions rather than hiding them", () => {
  assert.ok(Array.isArray(census.disclosed_omissions));
  for (const omission of census.disclosed_omissions) {
    assert.equal(typeof omission.source_id, "string");
    assert.ok(omission.reason.length > 0);
  }
});

test("every supplied source identity is unique", () => {
  const seen = new Set();
  for (const entry of census.entries) {
    assert.equal(seen.has(entry.source_id), false, `duplicate source identity ${entry.source_id}`);
    seen.add(entry.source_id);
  }
});

test("every entry declares exactly one semantic owner and one closed disposition", () => {
  for (const entry of census.entries) {
    assert.ok(
      DISPOSITIONS.includes(entry.disposition),
      `${entry.source_id} declares unknown disposition ${entry.disposition}`
    );
    assert.equal(typeof entry.semantic_owner, "string");
    assert.ok(entry.semantic_owner.length > 0, `${entry.source_id} must name a semantic owner`);
  }
});

test("ownership is internally consistent with the disposition", () => {

  for (const entry of census.entries) {
    if (entry.disposition === EXTERNAL) {
      assert.notEqual(entry.semantic_owner, "WK-2359",
        `${entry.source_id} is an external reference but claims WK-2359 ownership`);
      assert.equal(entry.adjudicated_by_wk_2359, false,
        `${entry.source_id} is externally owned and must not be adjudicated here`);
    } else {
      assert.equal(entry.semantic_owner, "WK-2359",
        `${entry.source_id} carries a WK-2359 disposition but a different owner`);
      assert.equal(entry.adjudicated_by_wk_2359, true);
    }
  }
});

test("a translated entry NAMES its translator (no missing public translation)", () => {
  for (const entry of census.entries) {
    if (entry.disposition !== LOCAL_TYPED && entry.disposition !== REGISTERED) continue;
    assert.ok(
      typeof entry.translator === "string" && entry.translator.length > 0,
      `${entry.source_id} claims a translation but names no translator`
    );
  }
});

test("no WK-2359-owned suppression is anonymous", () => {

  for (const entry of census.entries) {
    if (entry.disposition !== SUPPRESSION) continue;
    assert.ok(
      typeof entry.behavioural_witness === "string" && entry.behavioural_witness.length > 0,
      `${entry.source_id} is an anonymous suppression: it names no behavioural witness`
    );
    assert.ok(
      entry.note && entry.note.length > 0,
      `${entry.source_id} must state why suppressing is safe here`
    );
  }
});

test("every named behavioural witness is an executed test file that exists", () => {

  for (const entry of census.entries) {
    if (entry.disposition !== SUPPRESSION) continue;
    const witness = entry.behavioural_witness;
    assert.match(witness, /\.test\.mjs$/, `${entry.source_id} witness must be a test file`);
    assert.ok(
      existsSync(path.join(REPO_ROOT, witness)),
      `${entry.source_id} names witness ${witness}, which does not exist`
    );
  }
});

test("no confirmed public-translation defect is ownerless", () => {
  for (const entry of census.entries) {
    if (entry.disposition !== DEFECT) continue;
    assert.match(
      entry.owner_wk ?? "",
      /^WK-\d{4}$/,
      `${entry.source_id} is a confirmed defect with no canonical owner WK`
    );
  }
});

test("WK-2382-owned references carry ownership only and are not re-witnessed", () => {
  const external = census.entries.filter((entry) => entry.disposition === EXTERNAL);
  assert.ok(external.length > 0, "the async/process-guard population must be represented");
  for (const entry of external) {
    assert.equal(entry.semantic_owner, "WK-2382");

    assert.equal("translator" in entry, false,
      `${entry.source_id} is WK-2382-owned and must not declare a translator here`);
    assert.equal("behavioural_witness" in entry, false,
      `${entry.source_id} is WK-2382-owned and must not be re-witnessed here`);
  }
});

test("each in-scope source file reaches a consistent set of named translators", () => {

  const declared = new Set(census.provenance.audited_source_files);
  for (const entry of census.entries) {
    assert.ok(
      declared.has(entry.source_file),
      `${entry.source_id} comes from ${entry.source_file}, which is outside the declared audit population`
    );
    assert.equal(typeof entry.source_line, "number");
    assert.ok(entry.source_line > 0);
    assert.equal(typeof entry.catch_ordinal, "number");
  }
});

test("source identities are ordinal-keyed so the corpus survives line drift", () => {

  for (const entry of census.entries) {
    assert.match(entry.source_id, /#catch\d+$/,
      `${entry.source_id} must be keyed by catch ordinal, not by line number`);
  }
});

test("normal exception translators never document operator_recovery_needed as a fallback", () => {
  for (const entry of census.entries) {
    if (!entry.note?.includes("operator_recovery_needed")) continue;
    assert.match(entry.note, /modeled exceptions become specific typed refusals/i, entry.source_id);
    assert.match(entry.note, /authenticated unexpected external condition/i, entry.source_id);
    assert.match(entry.note, /exact identity is preserved/i, entry.source_id);
  }
});

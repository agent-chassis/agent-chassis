import { profileDigest } from "../lib/profile-digest.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";

import { readFile } from "node:fs/promises";

import {
  AdmittedProofPackError,
  assertAdmittedProofPackSnapshot,
  assertComponentExclusionApplicability,
  loadExactAdmittedProofPack,
  loadAdmittedProofPack,
  readProofPackCatalog,
  rebindComponentExclusionApplicability
} from "../lib/admitted-proof-packs.mjs";

const execFileAsync = promisify(execFile);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`
  ).digest("hex");
}

function buildFixture() {
  const profile = {
    schema_version: "controlled-contract-verification-profile.v2",
    profile_id: "proof.fixture.applicability",
    profile_version: "1.0.0",

    reference_binding_patterns: [{
      pattern_id: "reference-a",

    }],
    claim_patterns: [{ pattern_id: "claim-a" }],
    relation_patterns: [],
    collection_patterns: [],
    resolver_fact_patterns: [],
    evidence_patterns: []
  };
  const admission = {
    schema_version: "controlled-contract-admitted-proof-pack.v1",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest(profile),
    guarantee: "fixture guarantee",
    guarantee_digest: createHash("sha256").update("fixture guarantee").digest("hex"),
    explicit_exclusions: ["exclusion-a", "exclusion-b", "exclusion-c"]
  };
  const companion = {
    schema_version: "controlled-contract-component-exclusion-applicability.v2",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: admission.profile_digest,
    admission_digest: canonicalDigest(admission),
    components: [
      {
        selector: { kind: "claim", component_id: "claim-a" },

        exclusion_ids: ["exclusion-a", "exclusion-b", "exclusion-c"],
        applicable_exclusion_ids: []
      },
      {
        selector: { kind: "reference_binding", component_id: "reference-a" },

        exclusion_ids: ["exclusion-a", "exclusion-b", "exclusion-c"],
        applicable_exclusion_ids: ["exclusion-a", "exclusion-b"]
      }
    ]
  };
  return { profile, admission, companion };
}

function clone(value) {
  return structuredClone(value);
}

function assertRefused(value, profile, admission, code =
  "proof_pack_component_exclusion_applicability_binding_mismatch") {
  assert.throws(
    () => assertComponentExclusionApplicability(value, profile, admission),
    (error) => error instanceof AdmittedProofPackError && error.code === code
  );
}

test("absent companions supply no authenticated applicability fact", () => {
  const { profile, admission } = buildFixture();
  assert.deepEqual(
    assertComponentExclusionApplicability(null, profile, admission),
    {
      component_exclusion_applicability: null,
      component_exclusion_applicability_digest: null
    }
  );
});

test("empty and nonempty subsets are recognized exactly and are digest-bound", () => {
  const { profile, admission, companion } = buildFixture();
  const recognized = assertComponentExclusionApplicability(
    companion, profile, admission
  );
  assert.deepEqual(recognized.component_exclusion_applicability, companion);
  assert.equal(
    recognized.component_exclusion_applicability_digest,
    canonicalDigest(companion)
  );
  assert.deepEqual(
    recognized.component_exclusion_applicability.components[0]
      .applicable_exclusion_ids,
    []
  );
  assert.notStrictEqual(recognized.component_exclusion_applicability, companion);
  companion.components[0].applicable_exclusion_ids.push("forged");
  assert.deepEqual(
    recognized.component_exclusion_applicability.components[1]
      .applicable_exclusion_ids,
    ["exclusion-a", "exclusion-b"]
  );
});

test("loader recognizes the upgraded pack and preserves exact applicability subsets", async () => {
  const pack = await loadAdmittedProofPack(
    "proof.design.implementation-readiness"
  );
  assert.equal(pack.admission_version, 3);
  assert.equal(pack.profile.profile_version, "4.0.0");
  assert.match(pack.component_exclusion_applicability_digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(pack.component_exclusion_applicability.components.map((component) => [
    component.selector.component_id, component.applicable_exclusion_ids
  ]), [
    ["design-names-grounded-loci", []],
    ["warning-shape-verification", ["warning-runtime-execution"]]
  ]);
  assertAdmittedProofPackSnapshot(pack);
  assert.equal(Object.isFrozen(pack), true);
});

test("exact loader admits only the current test-validity identity", async () => {
  const execution = await loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity",
    profileVersion: "11.0.0",

  });
  assert.equal(execution.profile.profile_version, "11.0.0");

  assert.equal(execution.test_validity_evaluator.implementation_version, "9.0.0");
  assertAdmittedProofPackSnapshot(execution);

  for (const profileVersion of ["1.0.0", "8.0.0", "9.0.0", "10.0.0", "9.9.9"]) {
    await assert.rejects(loadExactAdmittedProofPack({
      profileId: "proof.verification.test-validity",
      profileVersion,

    }), (error) => error.code === "proof_pack_exact_version_not_current", profileVersion);
  }
  await assert.rejects(loadExactAdmittedProofPack({
    profileId: "../proof.verification.test-validity",
    profileVersion: "8.0.0",

  }), (error) => error.code === "proof_pack_exact_identity_invalid");
});

test("loader refuses a non-ENOENT companion read and preserves optional companion absence", async () => {
  const profileId = "proof.atomicity.failure-boundary";
  const moduleUrl = new URL("../lib/admitted-proof-packs.mjs", import.meta.url).href;
  const child = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const originalReadFile = fs.promises.readFile;
    fs.promises.readFile = async (target, ...args) => {
      if (String(target).endsWith(
        "/${profileId}/4.0.0/component-exclusion-applicability.json"
      )) throw Object.assign(new Error("injected read refusal"), { code: "EACCES" });
      return originalReadFile(target, ...args);
    };
    syncBuiltinESMExports();
    const { loadAdmittedProofPack } = await import(${JSON.stringify(moduleUrl)});
    try {
      await loadAdmittedProofPack(${JSON.stringify(profileId)});
      process.exitCode = 2;
    } catch (error) {
      process.stdout.write(JSON.stringify({
        name: error.name, code: error.code, cause: error.details?.cause
      }));
    }
  `;
  const { stdout } = await execFileAsync(process.execPath,
    ["--input-type=module", "--eval", child]);
  assert.deepEqual(JSON.parse(stdout), {
    name: "AdmittedProofPackError",
    code: "proof_pack_component_exclusion_applicability_invalid",
    cause: "EACCES"
  });
  const legacy = await loadAdmittedProofPack(profileId);
  assert.equal(legacy.component_exclusion_applicability, null);
  assert.equal(legacy.component_exclusion_applicability_digest, null);
});

test("every authenticated identity, component, domain, subset, and ordering mutation fails closed", () => {
  const fixture = buildFixture();
  const mutations = [
    ["profile id", (value) => { value.profile_id = "proof.other"; }],
    ["profile version", (value) => { value.profile_version = "9.9.9"; }],
    ["profile digest", (value) => { value.profile_digest = "0".repeat(64); }],
    ["admission digest", (value) => { value.admission_digest = "0".repeat(64); }],
    ["component kind", (value) => { value.components[1].selector.kind = "claim"; }],
    ["component id", (value) => { value.components[1].selector.component_id = "claim-a"; }],

    ["missing exclusion domain member", (value) => {
      value.components[0].exclusion_ids.pop();
    }],
    ["extra exclusion domain member", (value) => {
      value.components[0].exclusion_ids.push("exclusion-d");
    }],
    ["reordered exclusion domain", (value) => {
      value.components[0].exclusion_ids.reverse();
    }],
    ["applicable subset escape", (value) => {
      value.components[1].applicable_exclusion_ids.push("exclusion-d");
    }],
    ["reordered applicable subset", (value) => {
      value.components[1].applicable_exclusion_ids.reverse();
    }],
    ["duplicate component", (value) => {
      value.components.push(clone(value.components[0]));
    }],
    ["reordered components", (value) => { value.components.reverse(); }]
  ];
  for (const [label, mutate] of mutations) {
    const candidate = clone(fixture.companion);
    mutate(candidate);
    assertRefused(candidate, fixture.profile, fixture.admission, undefined);
    assert.notEqual(label, "", "mutation should remain named for diagnostics");
  }
});

test("schema-invalid and unsupported companion fields refuse before binding recognition", () => {
  const fixture = buildFixture();
  const rootField = clone(fixture.companion);
  rootField.unsupported = true;
  assertRefused(rootField, fixture.profile, fixture.admission,
    "proof_pack_component_exclusion_applicability_invalid");

  const nestedField = clone(fixture.companion);
  nestedField.components[0].unsupported = true;
  assertRefused(nestedField, fixture.profile, fixture.admission,
    "proof_pack_component_exclusion_applicability_invalid");

  const wrongSchema = clone(fixture.companion);
  wrongSchema.schema_version = "controlled-contract-component-exclusion-applicability.v1";
  assertRefused(wrongSchema, fixture.profile, fixture.admission,
    "proof_pack_component_exclusion_applicability_invalid");
});

test("callers cannot mint, copy, substitute, or partially construct recognized snapshots", () => {
  const fixture = buildFixture();
  const recognized = assertComponentExclusionApplicability(
    fixture.companion, fixture.profile, fixture.admission
  );
  for (const candidate of [
    recognized,
    clone(recognized),
    { ...recognized },
    { component_exclusion_applicability: fixture.companion },
    { ...recognized, component_exclusion_applicability_digest: "0".repeat(64) }
  ]) {
    assert.throws(
      () => assertAdmittedProofPackSnapshot(candidate),
      (error) => error instanceof AdmittedProofPackError &&
        error.code === "proof_pack_snapshot_unrecognized"
    );
  }
});

test("every shipped companion is bound to the admission shipped beside it", async () => {
  const catalog = await readProofPackCatalog();
  let companions = 0;
  for (const entry of catalog.packs) {
    const directory = new URL(`../${entry.path}/`, import.meta.url);
    const read = async (name) => JSON.parse(
      await readFile(new URL(name, directory), "utf8")
    );
    let companion;
    try {
      companion = await read("component-exclusion-applicability.json");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    companions += 1;
    const [profile, admission] = await Promise.all([
      read("profile.json"), read("admission.json")
    ]);

    assert.deepEqual(
      rebindComponentExclusionApplicability(companion, profile, admission),
      companion,
      `${entry.profile_id} companion is stale against its own admission`
    );
  }
  assert.ok(companions > 0, "no shipped companion was checked");
});

test("every admitted pack in the published catalog loads", async () => {
  const catalog = await readProofPackCatalog();
  const refusals = [];
  for (const entry of catalog.packs) {
    try {
      await loadAdmittedProofPack(entry.profile_id);
    } catch (error) {
      refusals.push(`${entry.profile_id}: ${error.code}`);
    }
  }
  assert.deepEqual(refusals, []);
  assert.equal(catalog.packs.length, 37);
});

test("rebinding refuses to drop an authored applicability judgment", () => {
  const { profile, admission, companion } = buildFixture();

  const narrowed = { ...admission, explicit_exclusions: [] };
  assert.throws(
    () => rebindComponentExclusionApplicability(companion, profile, narrowed),
    (error) => error instanceof AdmittedProofPackError &&
      error.code === "proof_pack_component_exclusion_applicability_binding_mismatch"
  );

  const withoutClaims = { ...profile, claim_patterns: [] };
  assert.throws(
    () => rebindComponentExclusionApplicability(companion, withoutClaims, admission),
    (error) => error instanceof AdmittedProofPackError &&
      error.code === "proof_pack_component_exclusion_applicability_binding_mismatch"
  );
});

test("exact loading refuses historical definitions and removed classification inputs", async () => {
  for (const profileVersion of ["2.0.0", "4.0.0"]) {
    await assert.rejects(loadExactAdmittedProofPack({
      profileId: "proof.verification.test-validity", profileVersion
    }), { code: "proof_pack_exact_version_not_current" });
  }
  await assert.rejects(loadExactAdmittedProofPack({
    profileId: "proof.verification.test-validity", profileVersion: "5.0.0",
    evaluationStage: "pre_dispatch"
  }), { code: "proof_pack_exact_identity_invalid" });
});

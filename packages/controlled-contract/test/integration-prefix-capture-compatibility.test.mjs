import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  ARTIFACTS,
  compareIntegrationPrefixCaptureCompatibility
} from "../lib/integration-prefix-capture-compatibility.mjs";
import {
  ARTIFACTS as STABLE_ARTIFACTS,
  compareIntegrationPrefixCaptureCompatibility as stableCompare,
  compareIntegrationPrefixCompatibility as stableAlias
} from "../current.mjs";
import { loadAdmittedProofPack, readProofPackCatalog } from "../lib/admitted-proof-packs.mjs";
import { canonicalJsonBytes } from "../lib/deterministic-projection-primitives.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const canonicalHistorical = path.join(packageRoot, "profiles/proof.integration.prefix-safety/1.0.0");
const canonicalCurrent = path.join(packageRoot, "profiles/proof.integration.prefix-safety/2.0.0");
const canonicalDirectory = { "1.0.0": canonicalHistorical, "2.0.0": canonicalCurrent };

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

const result = await compareIntegrationPrefixCaptureCompatibility();

test("stable exports preserve the owner API and deterministic result", async () => {
  assert.strictEqual(STABLE_ARTIFACTS, ARTIFACTS);
  assert.strictEqual(stableCompare, compareIntegrationPrefixCaptureCompatibility);
  assert.strictEqual(stableAlias, compareIntegrationPrefixCaptureCompatibility);
  assert.deepEqual(await stableCompare(), result);
});

test("binds all five historical and current artifacts", () => {
  assert.equal(ARTIFACTS.length, 5);
  assert.deepEqual(Object.keys(result.sources.old), ARTIFACTS);
  assert.deepEqual(Object.keys(result.sources.current), ARTIFACTS);
  for (const side of [result.sources.old, result.sources.current]) {
    for (const artifact of ARTIFACTS) {
      assert.match(side[artifact].path, new RegExp(`${artifact.replaceAll(".", "\\.")}$`));
      assert.match(side[artifact].sha256, /^[0-9a-f]{64}$/u);
    }
  }
});

test("records exact source paths and byte digests", async () => {
  for (const side of [result.sources.old, result.sources.current]) {
    for (const artifact of ARTIFACTS) {
      const bytes = await readFile(side[artifact].path);
      assert.equal(side[artifact].sha256, createHash("sha256").update(bytes).digest("hex"));
    }
  }
});

test("positive comparison is explicit, lossless, deterministic, and non-authoritative", async () => {
  assert.equal(result.outcome, "lossless_with_migration");
  assert.equal(result.authoritative, false);
  assert.equal(result.route_compatible, false);
  assert.equal(result.proof_credit, false);
  assert.equal(result.migration.complete, true);
  assert.equal(result.migration.total, result.differences.length);
  assert.equal(new Set(result.differences.map(({ pointer }) => pointer)).size,
    result.differences.length);
  const again = await compareIntegrationPrefixCaptureCompatibility();
  assert.deepEqual(result, again);
});

test("accounts for each explicit migration exactly once", () => {
  assert.ok(result.migration.explicit.length > 0);
  assert.equal(result.migration.explicit.length, result.migration.total);
  for (const entry of result.migration.explicit) {
    assert.notEqual(entry.classification, "unmapped");
    assert.notEqual(entry.old_value, entry.new_value);
  }
});

test("reports current catalog admission separately", () => {
  assert.equal(result.catalog.admitted, true);
  assert.equal(result.catalog.entry.profile_version, "2.0.0");
  assert.equal(result.admission.observed, true);
});

test("typed source failures never become compatibility claims", async () => {
  const missing = await compareIntegrationPrefixCaptureCompatibility({
    oldDirectory: "/path/that/does/not/exist"
  });
  assert.equal(missing.outcome, "source_unavailable");
  assert.equal(missing.error.code, "source_unavailable");
});

async function copiedProfiles() {
  const root = await mkdtemp(path.join(tmpdir(), "prefix-compatibility-"));
  const oldDirectory = path.join(root, "old");
  const currentDirectory = path.join(root, "current");
  await cp(new URL("../profiles/proof.integration.prefix-safety/1.0.0", import.meta.url), oldDirectory, { recursive: true });
  await cp(new URL("../profiles/proof.integration.prefix-safety/2.0.0", import.meta.url), currentDirectory, { recursive: true });
  return { root, oldDirectory, currentDirectory };
}

test("classifies every changed array member at an escaped index pointer", async () => {
  const fixture = await copiedProfiles();
  try {
    const filename = path.join(fixture.currentDirectory, "profile.json");
    const profile = JSON.parse(await readFile(filename, "utf8"));
    profile.relation_patterns[0].pattern_id = "changed";
    await writeFile(filename, `${JSON.stringify(profile, null, 2)}\n`);
    const changed = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(changed.outcome, "incompatible");
    assert.ok(changed.differences.some(({ pointer }) => pointer === "/profile/relation_patterns/0/pattern_id"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects malformed and unexpected carriers as typed source failures", async () => {
  const fixture = await copiedProfiles();
  try {
    const inputFilename = path.join(fixture.currentDirectory, "evaluation-input.template.json");
    const input = JSON.parse(await readFile(inputFilename, "utf8"));
    input.input_version = "unexpected";
    await writeFile(inputFilename, `${JSON.stringify(input)}\n`);
    const malformed = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(malformed.outcome, "source_unavailable");
    assert.equal(malformed.error.code, "malformed_artifact");
    await writeFile(path.join(fixture.currentDirectory, "unexpected.json"), "{}\n");
    const unexpected = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(unexpected.outcome, "source_unavailable");
    assert.equal(unexpected.error.code, "unexpected_artifact");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("requires exact values for every mapped digest, not only its pointer", async () => {
  const fixture = await copiedProfiles();
  try {
    const filename = path.join(fixture.currentDirectory, "exact-binding.json");
    const binding = JSON.parse(await readFile(filename, "utf8"));
    binding.profile_digest = "0".repeat(64);
    await writeFile(filename, `${JSON.stringify(binding, null, 2)}\n`);
    const changed = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(changed.outcome, "incompatible");
    assert.equal(changed.differences.find(({ pointer }) => pointer === "/exact-binding/profile_digest").classification, "unmapped");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("refuses byte-distinct current sources even when JSON semantics are unchanged", async () => {
  const fixture = await copiedProfiles();
  try {
    const filename = path.join(fixture.currentDirectory, "profile.json");
    await writeFile(filename, `${await readFile(filename, "utf8")} `);
    const changed = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(changed.outcome, "incompatible");
    assert.equal(changed.sources.current["profile.json"].path, filename);
    assert.notEqual(changed.sources.current["profile.json"].sha256, result.sources.current["profile.json"].sha256);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function setPointer(value, at, replacement) {
  const parts = at.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  const key = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[key] = replacement;
}

test("rejects the other 22 explicit migration pointer/value pairs", async () => {
  const cases = result.differences.filter(({ pointer }) => pointer !== "/profile/profile_version");
  assert.equal(cases.length, 22);
  for (const entry of cases) {
    const fixture = await copiedProfiles();
    try {
      const artifact = `${entry.pointer.split("/")[1]}.json`;
      const filename = path.join(fixture.currentDirectory, artifact);
      const value = JSON.parse(await readFile(filename, "utf8"));
      setPointer(value, entry.pointer.replace(`/${artifact.replace(/\.json$/u, "")}`, ""), entry.old_value);
      await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
      const changed = await compareIntegrationPrefixCaptureCompatibility(fixture);
      const repeated = await compareIntegrationPrefixCaptureCompatibility(fixture);
      assert.equal(changed.outcome, "incompatible", entry.pointer);
      assert.equal(changed.sources?.current?.[artifact]?.path ?? filename, filename);
      assert.equal(changed.error.details.canonical_differences.length, 1);
      const difference = changed.error.details.canonical_differences[0];
      assert.equal(difference.pointer, entry.pointer);
      assert.deepEqual(difference.expected_value, entry.new_value);
      assert.deepEqual(difference.actual_value, entry.old_value);
      assert.deepEqual(canonicalJsonBytes(changed), canonicalJsonBytes(repeated));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("returns malformed-artifact when current profile_version is absent", async () => {
  const fixture = await copiedProfiles();
  try {
    const filename = path.join(fixture.currentDirectory, "profile.json");
    const profile = JSON.parse(await readFile(filename, "utf8"));
    delete profile.profile_version;
    await writeFile(filename, `${JSON.stringify(profile, null, 2)}\n`);
    const malformed = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(malformed.outcome, "source_unavailable");
    assert.equal(malformed.error.code, "malformed_artifact");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("refuses byte-identical noncanonical paths with expected/actual bindings", async () => {
  const fixture = await copiedProfiles();
  try {
    const changed = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(changed.outcome, "incompatible");
    assert.equal(changed.error.code, "proof_pack_admission_binding_mismatch");
    const profile = changed.error.details.artifact_evidence.find(({ artifact }) => artifact === "profile.json");
    assert.equal(profile.expected.path, path.resolve(new URL("../profiles/proof.integration.prefix-safety/2.0.0", import.meta.url).pathname, "profile.json"));
    assert.equal(profile.actual.path, path.join(fixture.currentDirectory, "profile.json"));
    assert.match(profile.expected.sha256, /^[0-9a-f]{64}$/u);
    assert.match(profile.actual.sha256, /^[0-9a-f]{64}$/u);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("returns source_unavailable when an artifact moves for the full comparison interval", async () => {
  const changed = await compareIntegrationPrefixCaptureCompatibility({
    beforeFinalObservation: async () => {
      const error = new Error("profile moved during comparison");
      error.code = "source_changed";
      error.details = { artifact: "profile.json" };
      throw error;
    }
  });
  assert.equal(changed.outcome, "source_unavailable");
  assert.equal(changed.error.code, "source_changed");
  assert.equal(changed.error.details.artifact, "profile.json");
});

test("classifies stable catalog-selection divergence as incompatible", async () => {
  const admission = await loadAdmittedProofPack("proof.integration.prefix-safety");
  const changed = await compareIntegrationPrefixCaptureCompatibility({
    readProofPackCatalog,
    loadAdmittedProofPack: async () => ({ ...admission,
      catalog_entry: { ...admission.catalog_entry, path: "profiles/other" } }),
    readCanonicalSources: undefined
  });
  assert.equal(changed.outcome, "incompatible");
  assert.equal(changed.error.code, "proof_pack_admission_binding_mismatch");
  assert.equal(changed.error.details.stable_owner_divergence, true);
});

test("classifies stable admitted-snapshot divergence as incompatible", async () => {
  const admission = await loadAdmittedProofPack("proof.integration.prefix-safety");
  const changed = await compareIntegrationPrefixCaptureCompatibility({
    loadAdmittedProofPack: async () => ({ ...admission,
      profile: { ...admission.profile, profile_version: "1.0.0" } })
  });
  assert.equal(changed.outcome, "incompatible");
  assert.equal(changed.error.code, "proof_pack_admission_binding_mismatch");
});

test("returns source_unavailable when observations move between catalog and admission reads", async () => {
  const admission = await loadAdmittedProofPack("proof.integration.prefix-safety");
  const moved = { ...admission, catalog_entry: { ...admission.catalog_entry, path: "profiles/moved" } };
  const changed = await compareIntegrationPrefixCaptureCompatibility({
    readProofPackCatalog,
    loadAdmittedProofPack: async () => moved
  });
  assert.equal(changed.outcome, "incompatible");
  assert.equal(changed.error.code, "proof_pack_admission_binding_mismatch");
  assert.equal(changed.error.details.stable_owner_divergence, true);
});

test("returns source_unavailable when catalog or admission moves later", async () => {
  const admission = await loadAdmittedProofPack("proof.integration.prefix-safety");
  let reads = 0;
  const changed = await compareIntegrationPrefixCaptureCompatibility({
    readProofPackCatalog: async () => {
      const catalog = await readProofPackCatalog();
      reads += 1;
      if (reads > 1) {
        const index = catalog.packs.findIndex(({ profile_id }) => profile_id === "proof.integration.prefix-safety");
        catalog.packs[index] = { ...catalog.packs[index], path: "profiles/moved" };
      }
      return catalog;
    },
    loadAdmittedProofPack: async () => admission
  });
  assert.equal(changed.outcome, "source_unavailable");
  assert.equal(changed.error.code, "source_unavailable");
  assert.ok(changed.error.details.differences);
});

test("routes missing owner-required input fields through typed malformed-artifact", async () => {
  const fixture = await copiedProfiles();
  try {
    const filename = path.join(fixture.currentDirectory, "evaluation-input.template.json");
    const input = JSON.parse(await readFile(filename, "utf8"));
    delete input.evaluation_stage;
    await writeFile(filename, `${JSON.stringify(input, null, 2)}\n`);
    const malformed = await compareIntegrationPrefixCaptureCompatibility(fixture);
    assert.equal(malformed.outcome, "source_unavailable");
    assert.equal(malformed.error.code, "malformed_artifact");
    assert.ok(malformed.error.details.diagnostics.length > 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects each remaining semantic discriminator as incompatible", async (t) => {
  const mutations = [
    ["guarantee", "admission.json", (value) => { value.guarantee += " changed"; }],
    ["role", "profile.json", (value) => { value.reference_roles[0].role = "changed"; }],
    ["reference-role count binding", "profile.json", (value) => {
      value.reference_role_count_bindings[0].number_role = "changed";
    }],
    ["exclusion", "admission.json", (value) => { value.explicit_exclusions.reverse(); }],
    ["exact-binding requirement", "exact-binding.json", (value) => {
      value.requirements[0].requirement_id = "changed";
    }]
  ];
  for (const [label, artifact, mutate] of mutations) {
    await t.test(label, async () => {
      const fixture = await copiedProfiles();
      try {
        const filename = path.join(fixture.currentDirectory, artifact);
        const value = JSON.parse(await readFile(filename, "utf8"));
        mutate(value);
        await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
        const changed = await compareIntegrationPrefixCaptureCompatibility(fixture);
        assert.equal(changed.outcome, "incompatible");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("requires collection and guarantee digest owner fields", async () => {
  for (const [artifact, field] of [["profile.json", "collection_patterns"], ["admission.json", "guarantee_digest"]]) {
    const fixture = await copiedProfiles();
    try {
      const filename = path.join(fixture.currentDirectory, artifact);
      const value = JSON.parse(await readFile(filename, "utf8"));
      delete value[field];
      await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
      const malformed = await compareIntegrationPrefixCaptureCompatibility(fixture);
      assert.equal(malformed.outcome, "source_unavailable");
      assert.equal(malformed.error.code, "malformed_artifact");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("the packed publication ships and imports the compatibility module", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "prefix-compatibility-pack-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const { stdout } = await execFileAsync("npm", [
    "pack", "--json", "--ignore-scripts", "--pack-destination", temporary,
    "--cache", path.join(temporary, "npm-cache")
  ], { cwd: packageRoot, env: childEnvironment(), maxBuffer: 8 * 1024 * 1024 });
  const archive = path.join(temporary, JSON.parse(stdout)[0].filename);
  const { stdout: listing } = await execFileAsync("tar", ["-tzf", archive],
    { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(listing.split("\n").includes(
    "package/lib/integration-prefix-capture-compatibility.mjs"), true);
  const extractRoot = path.join(temporary, "extract");
  await mkdir(extractRoot);
  await execFileAsync("tar", ["-xzf", archive, "-C", extractRoot]);
  const extracted = path.join(extractRoot, "package");
  await symlink(path.resolve(packageRoot, "../../node_modules"),
    path.join(extracted, "node_modules"), "dir");
  const packed = await import(pathToFileURL(path.join(extracted, "current.mjs")).href);
  assert.deepEqual(packed.ARTIFACTS, ARTIFACTS);
  assert.equal(typeof packed.compareIntegrationPrefixCaptureCompatibility, "function");
  assert.equal(typeof packed.compareIntegrationPrefixCompatibility, "function");
  assert.equal(typeof packed.IntegrationPrefixCompatibilityError, "function");
});

test("refuses a byte-identical copy of the canonical historical source", async () => {
  const fixture = await copiedProfiles();
  try {
    assert.notEqual(result.error?.code, "historical_source_binding_mismatch");
    const runs = [
      await compareIntegrationPrefixCaptureCompatibility({ oldDirectory: fixture.oldDirectory }),
      await compareIntegrationPrefixCaptureCompatibility({ oldDirectory: fixture.oldDirectory })
    ];
    for (const changed of runs) {
      assert.notEqual(changed.outcome, "lossless_with_migration");
      assert.equal(changed.outcome, "incompatible");
      assert.equal(changed.error.code, "historical_source_binding_mismatch");
      assert.equal(changed.error.details.expected_directory, canonicalHistorical);
      assert.equal(changed.error.details.mismatched_artifacts.length, ARTIFACTS.length);
      assert.equal(changed.error.details.artifact_evidence.length, ARTIFACTS.length);
      for (const entry of changed.error.details.artifact_evidence) {
        assert.equal(entry.expected.path, path.join(canonicalHistorical, entry.artifact));
        assert.equal(entry.actual.path, path.join(fixture.oldDirectory, entry.artifact));
        assert.equal(entry.expected.sha256, entry.actual.sha256);
      }
    }
    assert.deepEqual(canonicalJsonBytes(runs[0]), canonicalJsonBytes(runs[1]));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("refuses a byte-modified historical source with digest evidence", async () => {
  const fixture = await copiedProfiles();
  try {
    const filename = path.join(fixture.oldDirectory, "profile.json");
    await writeFile(filename, `${await readFile(filename, "utf8")} `);
    const changed = await compareIntegrationPrefixCaptureCompatibility({
      oldDirectory: fixture.oldDirectory
    });
    const repeated = await compareIntegrationPrefixCaptureCompatibility({
      oldDirectory: fixture.oldDirectory
    });
    assert.notEqual(changed.outcome, "lossless_with_migration");
    assert.equal(changed.outcome, "incompatible");
    assert.equal(changed.error.code, "historical_source_binding_mismatch");
    const profile = changed.error.details.artifact_evidence.find(
      ({ artifact }) => artifact === "profile.json");
    assert.equal(profile.expected.path, path.join(canonicalHistorical, "profile.json"));
    assert.equal(profile.actual.path, filename);
    assert.notEqual(profile.expected.sha256, profile.actual.sha256);
    assert.equal(profile.expected.sha256, result.sources.old["profile.json"].sha256);
    assert.deepEqual(canonicalJsonBytes(changed), canonicalJsonBytes(repeated));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("refuses added, removed, and renamed membership in either source", async (t) => {
  const mutations = [
    ["added", async (directory) => {
      await writeFile(path.join(directory, "unexpected.json"), "{}\n");
      return { missing: [], unexpected: ["unexpected.json"] };
    }],
    ["removed", async (directory) => {
      await rm(path.join(directory, "exact-binding.json"));
      return { missing: ["exact-binding.json"], unexpected: [] };
    }],
    ["renamed", async (directory) => {
      await rename(path.join(directory, "admission.json"),
        path.join(directory, "admission.renamed.json"));
      return { missing: ["admission.json"], unexpected: ["admission.renamed.json"] };
    }]
  ];
  for (const side of ["old", "current"]) {
    for (const [label, mutate] of mutations) {
      await t.test(`${side} ${label}`, async () => {
        const fixture = await copiedProfiles();
        try {
          const directory = side === "old" ? fixture.oldDirectory : fixture.currentDirectory;
          const expected = await mutate(directory);
          const changed = await compareIntegrationPrefixCaptureCompatibility(fixture);
          const repeated = await compareIntegrationPrefixCaptureCompatibility(fixture);
          assert.equal(changed.outcome, "source_unavailable");
          assert.equal(changed.error.code, "unexpected_artifact");
          const membership = changed.error.details.membership;
          assert.equal(membership.directory, directory);
          assert.equal(membership.version, side === "old" ? "1.0.0" : "2.0.0");
          assert.deepEqual(membership.expected, ARTIFACTS.slice().sort());
          assert.deepEqual(membership.actual, membership.actual.slice().sort());
          assert.deepEqual(membership.missing, expected.missing);
          assert.deepEqual(membership.unexpected, expected.unexpected);
          assert.deepEqual(canonicalJsonBytes(changed), canonicalJsonBytes(repeated));
        } finally {
          await rm(fixture.root, { recursive: true, force: true });
        }
      });
    }
  }
});

test("refuses membership added to either source during final observation", async (t) => {
  for (const version of ["1.0.0", "2.0.0"]) {
    await t.test(version, async () => {
      const directory = canonicalDirectory[version];
      const name = `interval-membership-${version}.json`;
      const intruder = path.join(directory, name);
      const runs = [];
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          runs.push(await compareIntegrationPrefixCaptureCompatibility({
            beforeFinalObservation: async () => { await writeFile(intruder, "{}\n"); }
          }));
          await rm(intruder, { force: true });
        }
      } finally {
        await rm(intruder, { force: true });
      }
      for (const changed of runs) {
        assert.notEqual(changed.outcome, "lossless_with_migration");
        assert.equal(changed.outcome, "source_unavailable");
        assert.equal(changed.error.code, "unexpected_artifact");
        assert.equal(changed.error.details.membership.directory, directory);
        assert.equal(changed.error.details.membership.version, version);
        assert.deepEqual(changed.error.details.membership.missing, []);
        assert.deepEqual(changed.error.details.membership.unexpected, [name]);
        assert.deepEqual(changed.error.details.membership.actual,
          ARTIFACTS.concat(name).sort());
      }
      assert.deepEqual(canonicalJsonBytes(runs[0]), canonicalJsonBytes(runs[1]));
    });
  }
});

test("membership observation is sorted and independent of creation order", async () => {
  const observations = [];
  for (const order of [ARTIFACTS.slice().sort(), ARTIFACTS.slice().sort().reverse()]) {
    const root = await mkdtemp(path.join(tmpdir(), "prefix-compatibility-order-"));
    try {
      const oldDirectory = path.join(root, "old");
      await mkdir(oldDirectory);
      for (const name of [...order, "zz-unexpected.json"]) {
        await writeFile(path.join(oldDirectory, name), name === "zz-unexpected.json"
          ? Buffer.from("{}\n") : await readFile(path.join(canonicalHistorical, name)));
      }
      const changed = await compareIntegrationPrefixCaptureCompatibility({ oldDirectory });
      assert.equal(changed.outcome, "source_unavailable");
      assert.equal(changed.error.code, "unexpected_artifact");
      observations.push({ ...changed.error.details.membership, directory: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  assert.deepEqual(observations[0].actual, observations[0].actual.slice().sort());
  assert.deepEqual(observations[0], observations[1]);
});
